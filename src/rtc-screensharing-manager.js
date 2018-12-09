var _                       = require('underscore');
var $                       = require('jquery');
var my                      = require('myclass');
var Q                       = require('q');
var Backbone                = require('backbone');
var Logger                  = require('Logger');
var RTCBlueJay              = require('./rtc-bluejay');
var RTCStates               = require('./rtc-states');
var RTCErrors               = require('./rtc-error');
var RTCUtils                = require('./rtc-utils');
var RTCScreenSharingModel   = require('./rtc-screensharing-model');
var RTCSignallingManager    = require('./rtc-signalling-manager');
var RTCTransactionManager   = require('./rtc-transaction-manager');
var RTCStateManager         = require('./rtc-state-manager');
var browserDetector         = require('browserDetector');

var desktopMediaRequestId = null;

var RTCScreenSharingManager = my.Class({

    config: {
        chromeMediaConstraints: {
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource  : "desktop",
                    maxWidth           : 1920,
                    maxHeight          : 1080,
                },
                optional: [
                    {maxFrameRate       : 5},
                    {minFrameRate       : 5},
                    {googTemporalLayeredScreencast:true}
                ]
            }
        },
        ffMediaConstraints: {
            audio:false,
            video: {
                mediaSource : 'screen',
                width       : {"max" : "1920"},
                height      : {"max" : "1080"},
                frameRate   : {"exact" : "5"}
            }
        }
    },

    installationCompletedRetries: 0,
    maxInstallationCompletedRetries: 5,

    constructor: function (params) {
        _.bindAll(this);

        this.isFirefox  =   browserDetector.browser === 'firefox' ? true : false;
        this.model      =   new RTCScreenSharingModel();

        this.model.on('change:extensionStatus', this.onExtensionStatusChanged);
        this.model.on('change:tokenStatus', this.onTokenStatusChange);
    },

    setParams: function(params) {
        this.model.set('extensionId', params.extensionId);
        this.config.features = params.features;
        this.config.extensionID = params.extensionId;

        this.screenSharingExtensionUrl = "https://chrome.google.com/webstore/detail/" + params.extensionId;
    },

    onExtensionStatusChanged: function() {
        var currentState = this.model.get('extensionStatus');
        var states = RTCStates.EXTENSION_STATES;

        Logger.debug('RTCScreenSharingManager: Extension status changed to: ', currentState);

        switch(currentState) {
            case states.NOT_INSTALLED:
            break;

            case states.INSTALLING:
            break;

            case states.INSTALLED:
                if(this.doScreenSharing) {
                    Logger.debug('RTCScreenSharingManager: Screen sharing is on, sending msg to extension to get desktop media source ID');
                    this.getDesktopMediaSourceId();
                }
            break;

            case states.IFRAME_INSTALL_FAILED:
                this.model.set('screenShareState', RTCErrors.SCREEN_SHARING_STATES.INSTALL_EXTENSION_FAILED);
            break;

            case states.INSTALL_FAILED:
                this.model.set('screenShareState', RTCErrors.SCREEN_SHARING_STATES.INSTALL_EXTENSION_FAILED);
            break;

            case states.INSTALL_CANCELLED:
            break;

            case states.REQUEST_FAILED:
            break;

        }
    },

    startScreenSharing: function (options) {
        var self = this;
        var alreadyInstalled = this.model.isExtensionInstalled();
        var params = options || {};

        if(this.isFirefox) {
            this.initFFScreenSharing();
            this.doScreenSharing = true;
        }else {
            this.doScreenSharing = true;
            this.installationCompletedRetries = 0;
            this.model.set('extensionStatus', RTCStates.EXTENSION_STATES.NOT_INSTALLED);

            if(alreadyInstalled || params.skipInlineInstallation) {
                Logger.debug('RTCScreenSharingManager: Content Scripts have been injected, "ping" extension to check if extension is not uninstalled');
                this.pingAndStartSharing();
            } else {
                Logger.warn('RTCScreenSharingManager: Content Scripts have not been injected, extension has not been installed');
                if (browserDetector.browser === 'chrome') {
                    this.triggerInlineInstallation();
                } else if (browserDetector.browser === 'opera') {
                    this.triggerOperaAddOnInlineInstallation(options);
                }
            }
        }
    },

    stopScreenSharing: function () {
        this.doScreenSharing = false;
        var contentStream = this.model.get('localContentStream');

        if(contentStream) {
            Logger.debug('RTCScreenSharingManager: Stopping screen sharing now');
            contentStream.getTracks().forEach(function(track) {
                track.stop();
            });
            if(this.isFirefox)
                this.reset();
        } else {
            Logger.debug('RTCScreenSharingManager: Screen sharing has already been stopped');
            this.reset();
        }
    },

    triggerInlineInstallation: function() {
        var self = this;
        var successCallback = function (response) {
            Logger.debug("RTCScreenSharingManager: Chrome inline installation was successful.");
            self.model.set('extensionStatus', RTCStates.EXTENSION_STATES.INSTALLING);
            self.pingAndStartSharing();
        };

        var failureCallback = function (error) {
            self.handleInstallationFailure(error);
        };
        try {
            // Add the chrome extension link in the head tag for inline installation.
            $('head').append('<link rel="chrome-webstore-item" href=' + this.screenSharingExtensionUrl + '>');
            window.chrome.webstore.install(this.screenSharingExtensionUrl, successCallback, failureCallback);
        }
        catch(exception) {
            self.handleInstallationFailure(exception);
        }
    },

    triggerOperaAddOnInlineInstallation: function (options) {
        var self = this;
        var successCallback = function (response) {
            Logger.debug("RTCScreenSharingManager: Opera inline installation was successful.");
            self.model.set('extensionStatus', RTCStates.EXTENSION_STATES.INSTALLING);
            self.pingAndStartSharing();
        };
        var failureCallback = function (error) {
            self.handleInstallationFailure(error);
        };
        try {
            opr.addons.installExtension(self.config.extensionID, successCallback, failureCallback)
        } catch (exception) {
            self.handleInstallationFailure(exception);
        }
    },

    handleInstallationFailure: function(error) {
        var state;
        var states = RTCStates.EXTENSION_STATES;
        Logger.error('RTCScreenSharingManager: Inline installation of Chrome extension failed: ' + error);

        switch(error) {
            case "User cancelled install":
                state = states.INSTALL_CANCELLED;
                break;

            case "Chrome Web Store installations can only be started by the top frame.":
                state = states.IFRAME_INSTALL_FAILED;
                break;

            case "Installs can only be initiated by one of the Chrome Web Store item's verified sites.":
                state = states.INSTALL_FAILED_DOMAIN_UNVERIFIED;
                break;

            default: state = states.INSTALL_FAILED;
        }

        this.model.set('extensionStatus', state);
    },

    pingAndStartSharing: function() {
        var self = this;
        if(this.installationCompletedRetries < this.maxInstallationCompletedRetries) {

            window.setTimeout(function() {
                self.installationCompletedRetries++;

                Logger.debug('RTCScreenSharingManager: Sending "ping" to extension. Attempt no. ', self.installationCompletedRetries);

                self.pingExtension(function(message) {
                    self.installationCompletedRetries = 0;
                    self.onPingSuccess(message);
                }, function(error) {
                    if(error === 'emptyResponse') {
                        self.pingAndStartSharing();
                    } else {
                        self.model.set('extensionStatus', RTCStates.EXTENSION_STATES.REQUEST_FAILED);
                    }
                });
            }, 500);
        } else {
            this.model.set('extensionStatus', RTCStates.EXTENSION_STATES.INSTALL_FAILED);
        }
    },

    pingExtension: function(onSuccess, onError) {
        this.sendMessageToExtension({type: 'ping'}).then(onSuccess, onError);
    },

    onPingSuccess: function(message) {
        if((message.type === 'pong') && this.doScreenSharing) {
            this.model.set('extensionStatus', RTCStates.EXTENSION_STATES.INSTALLED, {silent: true});
            this.model.trigger('change:extensionStatus', this.model);
        }
    },

    getDesktopMediaSourceId: function() {
        var deferred = Q.defer();
        var self = this;

        this.model.set('tokenStatus', RTCBlueJay.TOKEN_STATUS.WAITING);

        // Make a request to screen sharing extension for getting chrome media source Id.
        // The below API will trigger extension to show the Screen Share Popup UI of chrome.

        this.sendMessageToExtension({
            type: 'getScreen',
            options: this.config.features.applicationSharing ? ['screen', 'window'] : ['screen']
        }).then(function(message) {
            switch(message.type) {
                case 'gotScreenSharing':
                    self.model.set('chromeMediaSourceId', message.sourceId);
                    self.requestToken();
                    break;
                case 'canceledGetScreen':
                    self.model.set('tokenStatus', RTCBlueJay.TOKEN_STATUS.CANCELLED);
                    break;
                default:
                    Logger.error('RTCScreenSharingManager: Unhandled message type for "getScreen" API');
                    self.model.set('tokenStatus', RTCBlueJay.TOKEN_STATUS.CANCELLED);
            }
        }, function(error) {

        });

        return deferred.promise;
    },

    sendMessageToExtension: function(params) {
        var deferred = Q.defer();
        var msg = _.extend({targetModule: 'RTCDesktopMedia'}, params);

        try {
            window.chrome.runtime.sendMessage(this.model.get('extensionId'), msg, _.bind(function (message) {

                Logger.debug("RTCScreenSharingManager: Response from extension: " + JSON.stringify(message));

                if(_.isUndefined(message)) {
                    deferred.reject('emptyResponse');
                } else {
                    deferred.resolve(message);
                }
            }, this));
        } catch(exception) {
            Logger.error('RTCScreenSharingManager: Exception occured while sending message to Extension: ', exception);
            deferred.reject('error');
        }

        return deferred.promise;
    },

    initFFScreenSharing: function() {
        this.model.set('tokenStatus', RTCBlueJay.TOKEN_STATUS.WAITING);
        this.getDesktopMediaStream();
    },

    getDesktopMediaStream: function() {
        var mediaSource = this.config.features.applicationSharing ? 'application': 'screen';
        this.config.ffMediaConstraints.video.mediaSource = mediaSource;
        var desktopStreamConstraints = this.isFirefox ? this.config.ffMediaConstraints : RTCUtils.deepMergeObjects(this.config.chromeMediaConstraints, {
            video: {
                mandatory: {chromeMediaSourceId: this.model.get('chromeMediaSourceId')}
            }
        });
        window.navigator.getUserMedia(desktopStreamConstraints, this.getDesktopMediaSuccess, this.getDesktopMediaError);
    },

    getDesktopMediaSuccess: function (stream) {
        Logger.debug("RTCScreenSharingManager: Local Content has been acquired");
        if(this.isFirefox) {
            this.requestToken();
        }
        stream.bjn_label = "content_stream";

        stream.getVideoTracks()[0].onended = _.bind(function () {
            Logger.debug("RTCScreenSharingManager: Local Content Stream has ended.");
            this.reset();
            if(!this.isFirefox)
                this.sendMessageToExtension({type: 'focusTab'});
        }, this);

        this.model.set('localContentStream', stream);
    },

    getDesktopMediaError: function (error) {
        Logger.error("Failed to get desktop media stream, error: ", error);
        var shouldTrigger = false;
        // If the token status is already 'cancelled', manually trigger an event
        // so that RTCController gets a cue to fire an event which hides the
        // UI overlay and cleans up any flags/tokens.
        if(this.model.get('tokenStatus') === RTCBlueJay.TOKEN_STATUS.CANCELLED) {
            shouldTrigger = true;
        }
        this.model.set('tokenStatus', RTCBlueJay.TOKEN_STATUS.CANCELLED);
        if(shouldTrigger) {
            this.model.trigger('change:firefoxScreenShareCancelled', this.model);
        }
        this.stopScreenSharing();
    },

    requestToken: function() {
        var tokenMsg = RTCBlueJay.requestTokenMsg();
        RTCSignallingManager.sendMsg(tokenMsg);
        if (RTCStateManager.getCurrentCallState() !== RTCStates.BJ_CALLSTATES.IDLE)
            RTCTransactionManager.onBlueJayRequest(tokenMsg);
    },

    releaseToken: function() {
        var tokenMsg = RTCBlueJay.releaseTokenMsg();
        RTCSignallingManager.sendMsg(tokenMsg);
        RTCTransactionManager.onBlueJayRequest(tokenMsg);
        this.model.set('tokenStatus', RTCBlueJay.TOKEN_STATUS.RELEASED);
    },

    handleTokenMessage: function(msg) {
        var tokenMsgType = msg.params.type;

        switch(tokenMsgType) {

            case RTCBlueJay.TOKEN_TYPES.STATUS:
                this.model.set('tokenStatus', msg.params.status);
                break;

            case RTCBlueJay.TOKEN_TYPES.TOKENINDICATION:
                this.model.set('presentationToken', msg.params);
                break;

            case RTCBlueJay.TOKEN_TYPES.CONTENTINDICATION:
                this.model.set('presentationToken', msg.params);
                break;

            default: Logger.error('RTCScreenSharingManager: Invalid type passed in token msg: ', tokenMsgType);
        }
    },

    onTokenStatusChange: function(model) {
        var tokenStatus = model.get('tokenStatus');
        switch(tokenStatus) {
            case RTCBlueJay.TOKEN_STATUS.GRANTED:
                if(this.doScreenSharing) {
                    if(!this.isFirefox) {
                        this.getDesktopMediaStream();
                    }
                } else {
                    Logger.info("RTCScreenSharingManager: Screen sharing was cancelled while acquiring token");
                    this.releaseToken();
                }
                break;
            case RTCBlueJay.TOKEN_STATUS.REVOKED:
                Logger.debug("RTCScreenSharingManager: Token has been 'revoked', must have been hijacked!");
                this.stopScreenSharing();
                break;
        }
    },

    sendPresentaionRatio: function(splitRatio) {
        var messageParams = {
            type: "presentationratio",
            ratio: {
                content: splitRatio.content,
                video: splitRatio.video
            }
        };
        var infoMsg = RTCBlueJay.getInfoMsg(messageParams);
        RTCSignallingManager.sendMsg(infoMsg);
        RTCTransactionManager.onBlueJayRequest(infoMsg);
    },

    reset: function() {
        this.doScreenSharing = false;
        var tokenStatus = this.model.get('tokenStatus');
        this.releaseToken();
        this.model.set('localContentStream', null);
        this.model.set('chromeMediaSourceId', null);
    },

    close: function() {
        this.stopScreenSharing();
    }

});

module.exports = new RTCScreenSharingManager();
