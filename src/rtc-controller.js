
/*
* Blue Jeans WebRTC Peer Connection Manager
* =====================================================================================
* @version In bower.json
*
*/

var Q                           = require('q');
var my                          = require('myclass');
var _                           = require('underscore');
var Backbone                    = require('backbone');
var Logger                      = require('Logger');
var BrowserDetector             = require('browserDetector');
var RTCBlueJay                  = require('./rtc-bluejay');
var RTCUtils                    = require('./rtc-utils');
var RTCSignallingManager        = require('./rtc-signalling-manager');
var RTCLocalMediaManager        = require('./rtc-local-media-manager');
var RTCPeerConnectionManager    = require('./rtc-peer-connection-manager');
var RTCTransactionManager       = require('./rtc-transaction-manager');
var RTCStateManager             = require('./rtc-state-manager');
var RTCStates                   = require('./rtc-states');
var uuid                        = require('uuid');
var RTCScreenSharingManager     = require('./rtc-screensharing-manager');
var RTCErrors                   = require('./rtc-error');
var RTCCapabilitiesManager      = require('./rtc-capabilities-manager');

var RTCCallStateModel = Backbone.Model.extend({

    defaults: {
        localVideoStream        : null,
        localAudioStream        : null,
        previewStream           : null,
        remoteStream            : null,
        localContentStream      : null,
        remoteContentStream     : null,
        connectionState         : '', // ICE Connection states
        callState               : '', // Call States - Waiting, InProgress, Ended, Failed,
        disconnectCode          : '', // Reason code for call getting disconnected
        localAudioMuted         : null,
        localVideoMuted         : null,
        remoteAudioMuted        : false,
        remoteVideoMuted        : false,
        isSpeaking              : false,
        volumeLevel             : 0,
        devices: {
            available: { audioIn: [], videoIn: [] },
            selected: { audioIn: null, videoIn: null }
        },
        presentationToken       : null,
        presentationState       : null,  // Current state of presentation sharing
        isWSConnected           : false,
        isIceRestarted          : false,
        capabilities            : {}
    }
});

var RTCPrivateModel = Backbone.Model.extend({

    defaults: {
        wsConnectionState       : 'closed',
        wsSocketId              : '',
        isIceRestarted          : false,
        dtlsCertificate         : null
    }
});


var RTCController = my.Class({

    config: {

    },

    resendMute: false,

    constructor: function(params) {
        _.bindAll(this);
        _.extend(this.config, params);
        _.extend(this, Backbone.Events);

        if(BrowserDetector.browser === 'firefox')
            this.isFirefox = true;

        this.model = new RTCCallStateModel();
        this.internalModel = new RTCPrivateModel();
        this.BJ_CALLSTATES = RTCStates.BJ_CALLSTATES;
        this.TOKEN_STATUS = RTCBlueJay.TOKEN_STATUS;
        this.EXTENSION_STATES = RTCStates.EXTENSION_STATES;
        this.WS_STATES = RTCStates.WS_STATES;

        this.localMediaManager = new RTCLocalMediaManager(this.config.localMediaParams);

        this.peerConnectionManager = new RTCPeerConnectionManager({
            'peerConfig'    : this.config.peerConfig,
            'meetingParams' : params.meetingParams
        });

        this.localMediaManager.model.on('change:localAudioStream', this.onLocalAudioStreamChange);
        this.localMediaManager.model.on('change:localVideoStream', this.onLocalVideoStreamChange);
        this.localMediaManager.model.on('change:previewStream', this.onPreviewStreamChange);
        this.localMediaManager.model.on('change:remoteAudioMuted', this.onRemoteAudioMuteChange);
        this.localMediaManager.model.on('change:remoteVideoMuted', this.onRemoteVideoMuteChange);
        this.localMediaManager.model.on('change:isSpeaking', this.isSpeaking);
        this.localMediaManager.model.on('change:volumeLevel', this.updateVolumeLevel);
        this.localMediaManager.on('localStreamsChanged', this.onLocalStreamsChanged);

        RTCTransactionManager.on('retransmitRequest', this.onRetransmitRequest);
        RTCTransactionManager.on('receivedConnectResponse', this.onReceiveConnectResponse);
        RTCTransactionManager.on('requestTimeout', this.onRequestTimeout);
        RTCTransactionManager.on('closeSocketConnection', this.closeSocket);

        RTCStateManager.model.on('change:disconnectCode', this.onDisconnectCodeChange);
        RTCStateManager.model.on('change:currentState', this.onCallStateChange);

        RTCSignallingManager.on('wsConnectionStateChange', this.wsConnectionStateChange);

        RTCScreenSharingManager.setParams({
            extensionId: this.config.extensionId,
            features: this.config.features
        });

        RTCScreenSharingManager.model.on('change:presentationToken', this.onReceivePresentationToken);
        RTCScreenSharingManager.model.on('change:localContentStream', this.onLocalContentStreamChanged);
        RTCScreenSharingManager.model.on('change:tokenStatus', this.onPresentationTokenStatusChanged);
        RTCScreenSharingManager.model.on('change:extensionStatus', this.onExtensionStatusChanged);
        RTCScreenSharingManager.model.on('change:firefoxScreenShareCancelled', this.triggerFirefoxScreenShareCancelled);
    },

    getLocalMedia: function(params,streamType) {
        var deferred = Q.defer();
        this.localMediaManager.startMedia(params, streamType).then(function(stream) {
            return deferred.resolve(stream);
        }, function(error) {
            Logger.warn("RTCController: Could not get access to user's media devices");
            return deferred.reject(error);
        });

        return deferred.promise;
    },

    getLocalDevices: function() {
        var self = this;
        var deferred = Q.defer();

        this.localMediaManager.getDevices().then(
            function(newDevices) {
                var devices = self.model.get("devices");
                devices.available = newDevices.available;
                devices.selected = newDevices.selected;
                self.model.set('devices', devices);
                deferred.resolve(devices);
            },  function(error) {
                deferred.reject(error);
            });
        return deferred.promise;
    },

    getCameraStatus: function(streamType) {
        return this.localMediaManager.detectCameraStatus(streamType);
    },

    getCapabilities: function() {
        return RTCCapabilitiesManager.detectCapabilities().then(_.bind(function() {
            this.model.set('capabilities', RTCCapabilitiesManager.model.attributes);
        }, this), function() {
            Logger.error('RTCController: failed to get RTC capabilities');
        });
    },

    setSpeaker: function(params) {
        this.localMediaManager.setSpeaker(params);
    },

    renderSelfView: function(params) {
        return this.localMediaManager.renderSelfView(params);
    },

    renderStream: function(params) {
        return this.localMediaManager.renderStream(params);
    },

    stopLocalMedia: function(stream) {
        this.localMediaManager.stopMedia(stream);
    },

    createPeerConnection: function(params) {
        this.peerConnectionManager.createPeer(params);

        this.peerConnectionManager.peer.model.on('change:remoteStream', this.onRemoteStreamChanged);
        this.peerConnectionManager.peer.model.on('change:remoteContentStream', this.onRemoteContentStreamChanged);

        this.peerConnectionManager.peer.on('iceConnectionClosed', this.onIceConnectivityClosed);
        this.peerConnectionManager.peer.on('restartICE', this.restartMediaChannel);
        this.peerConnectionManager.peer.on('iceConnectivityTimeout', this.onIceConnectivityTimeout);

        this.peerConnectionManager.peer.callStatsModel.on('change', function(callStats) {
            this.model.set(callStats.attributes);
        }, this);
    },

    onCallStateChange: function(model) {
        var newState = model.get('currentState');
        this.model.set('callState', newState);
        RTCTransactionManager.updateCallState(newState);
        this.reactToCallStateChange();
    },

    reactToCallStateChange: function() {
        var callState = this.model.get('callState');
        switch (callState) {
            case this.BJ_CALLSTATES.CONNECTED :
                this.model.set('isIceRestarted', false);
                break;
            case this.BJ_CALLSTATES.DISCONNECTED :
                this.reset();
                this.sendDisconnectMessage(RTCStateManager.getDisconnectReason());
                break;
            default : break;
        }
    },

    onDisconnectCodeChange: function() {
        this.model.set('disconnectCode', RTCStateManager.model.get('disconnectCode'));
    },

    initializePeerConnection: function(params, resetState) {
        if (resetState === undefined || resetState === true) {
            RTCStateManager.reset();
        }
        this.peerConnectionManager.initiateCall(params, true);
    },

    startConnection: function(params) {
        // Generate a new call-Id for the new signaling channel
        var callId = uuid.v1();
        RTCSignallingManager.createSocket(params);
        this.peerConnectionManager.updateMeetingParams(params);
        RTCBlueJay.setCallid(callId);
    },

    generateDtlsRsaCertificate: function() {
        var deferred = Q.defer();
        var self = this;
        var dtlsRSACert;
        if(webkitRTCPeerConnection.generateCertificate) {
            dtlsRSACert = self.internalModel.get('dtlsCertificate');
            if(!dtlsRSACert) {
                webkitRTCPeerConnection.generateCertificate({
                    name: 'RSASSA-PKCS1-v1_5',
                    hash: 'SHA-256',
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1])
                }).then(function(cert) {
                    Logger.debug("RTCController :: Successfully created DTLS RSA certificate");
                    self.internalModel.set('dtlsCertificate', cert);
                    deferred.resolve(cert);
                }, function(error) {
                    deferred.reject(error);
                });
            } else {
                deferred.resolve(dtlsRSACert);
            }
        } else {
            deferred.resolve();
        }
        return deferred.promise;
    },

    /* Use this API to makeCall from skinny, right now we need to call
        three APIs just to initiate the call. Skinny should only call one
        API to start the call */
    makeCall: function(peerParams, callParams) {
        var self = this;
        //reset old states, required in re-connection scenarios
        RTCTransactionManager.reset();
        RTCStateManager.reset();
        this.closeSocket();

        if(this.isFirefox) {
            self.startConnection(callParams);
            self.createPeerConnection(peerParams);
        } else {
            this.generateDtlsRsaCertificate().then(function(cert) {
                if (cert) {
                    peerParams.peerConfig.peerConnectionConfig.certificates = [cert];
                }
                self.startConnection(callParams);
                self.createPeerConnection(peerParams);
            }, function(error) {
                Logger.error("RTCController :: Failed to start call, Error :" + error);
            });
        }
    },

    joinMeeting: function() {
        var callState = this.model.get('callState');

        if(callState !== this.BJ_CALLSTATES.CONNECTING && callState !== this.BJ_CALLSTATES.RECONNECTING) {
            Logger.error('RTCController: callState is not in connecting/reconnecting state, cannot proceed with call yet');
            throw "Connection state not ready to call";
        }

        //TODO :: Temporary fix to set IceRestart to false, to prevent IceRestart during joinMeeting
        //Remove it once the params issue is fixed in skinny
        var offerParams = this.config.peerConfig.receiveMedia;
        offerParams.iceRestart = false;

        this.peerConnectionManager.initiateCall(offerParams, false);
    },

    restartMediaChannel: function() {
        var wsConnectionState = this.internalModel.get('wsConnectionState');

        if ((wsConnectionState === this.WS_STATES.CONNECTED || wsConnectionState === this.WS_STATES.RECONNECTED)
            && this.model.get('isIceRestarted') === false) {
            Logger.debug('Re-starting the media channel - ICE Restart, get new local SDP');
            var offerParams = this.config.peerConfig.receiveMedia;
            offerParams.iceRestart = true;
            this.initializePeerConnection(offerParams, false);
            this.model.set('isIceRestarted', true);
        } else {
            Logger.debug("RTCController : Failed to restart media channel, Signalling channel"+
                " is disconnected or media restart is already in progress.");
        }
    },

    //TODO:: Can move this function somewhere else
    onRetransmitRequest: function(message) {
        // Call the state manager with the change
        RTCSignallingManager.sendMsg(message);
    },

    onLocalAudioStreamChange: function(model) {
        this.model.set('localAudioStream', model.get('localAudioStream'));
    },

    onLocalVideoStreamChange: function(model) {
        this.model.set('localVideoStream', model.get('localVideoStream'));
    },

    onPreviewStreamChange: function(model) {
        this.model.set('previewStream', model.get('previewStream'));
    },

    onRemoteStreamChanged: function(model) {
        this.model.set('remoteStream', model.get('remoteStream'));
        this.localMediaManager.updateStream({remoteStream: model.get('remoteStream')});
    },

    onRemoteContentStreamChanged: function(model) {
        this.model.set('remoteContentStream', model.get('remoteContentStream'));
    },

    onReceivePresentationToken: function(model) {
        this.model.set('presentationToken', model.get('presentationToken'));
    },

    _applyCachedMuteStates: function() {
        Logger.info('RTCController: Applying cached mute states');
        this.muteStreams({
            resendMuteMsg: true,
            localAudio: this.localMediaManager.model.get('localAudioMuted'),
            localVideo: this.localMediaManager.model.get('localVideoMuted'),
            remoteAudio: this.localMediaManager.model.get('remoteAudioMuted'),
            remoteVideo: this.localMediaManager.model.get('remoteVideoMuted')
        });
    },

    muteStreams: function(params) {
        var self = this;
        var connectMsgAckd = RTCTransactionManager.model.get('connectResponseReceived');
        var localAudioToggled = _.isBoolean(params.localAudio) && (params.localAudio !== this.model.get('localAudioMuted'));
        var localVideoToggled = _.isBoolean(params.localVideo) && (params.localVideo !== this.model.get('localVideoMuted'));

        //Set the remote mute state in RTCPeer
        if(this.peerConnectionManager && this.peerConnectionManager.peer) {
            if(!_.isUndefined(params.remoteAudio) && !_.isUndefined(params.remoteVideo))
            {
                this.peerConnectionManager.peer.isRemoteMute = params.remoteAudio && params.remoteVideo;
            }
        }

        this.localMediaManager.muteStreams(params).then(function() {
            if(!params.localMuteOnly && connectMsgAckd) {
                if(localVideoToggled && (params.localVideo === false)) {
                    self.onLocalStreamsChanged();
                }

                var localAudioMuted = params.localAudio;
                var localVideoMuted = params.localVideo;
                var remoteAudioMuted = params.remoteAudio;
                var remoteVideoMuted = params.remoteVideo;

                var muteMsg = RTCBlueJay.getMuteMessage({
                        'audio': localAudioMuted ? "muted" : "unmuted",
                        'video': localVideoMuted ? "muted" : "unmuted",
                        'remoteAudio' : remoteAudioMuted ? "muted" : "unmuted",
                        'remoteVideo' : remoteVideoMuted ? "muted" : "unmuted"
                });
                // Local Stream Audio/Video mute states should be updated only after sending mute msg to connector.
                if(RTCSignallingManager.sendMsg(muteMsg)) {
                    RTCTransactionManager.onBlueJayRequest(muteMsg);
                    self.resendMute = false;
                } else {
                    self.resendMute = true ;
                }
                self.model.set({
                    'localAudioMuted': localAudioMuted,
                    'localVideoMuted': localVideoMuted
                });
            }
        }, function() {
            Logger.error("RTCController: Failed to Mute streams");
        });
    },

    onRemoteAudioMuteChange: function(model) {
        this.model.set('remoteAudioMuted', model.get('remoteAudioMuted'));
    },

    onRemoteVideoMuteChange: function(model) {
        this.model.set('remoteVideoMuted', model.get('remoteVideoMuted'));
    },

    updateLocalStream: function(params) {
        return this.peerConnectionManager.updatePeerStream(params);
    },

    startVolumeMonitoring: function(stream, options) {
        if(this.localMediaManager.volumeMoniter==null)
        {
            this.localMediaManager.startVolumeMonitor(stream, options);}
        else{
            Logger.debug("Already monitering volume");
        }
    },

    stopVolumeMonitoring: function() {
        this.localMediaManager.stopVolumeMonitor();
    },

    isSpeaking: function(model) {
        this.model.set('isSpeaking', model.get('isSpeaking'));
    },

    setIsSpeaking: function(val) {
        this.localMediaManager.model.set('isSpeaking', val);
        if(!val) {
            // Reset vad count if we are resetting isSpeaking flag.
            this.localMediaManager.vadCount = 0;
        }
    },

    updateVolumeLevel: function(model) {
        this.model.set('volumeLevel', model.get('volumeLevel'));
    },

    onLocalStreamsChanged: function() {
        var newAudioStream          = this.localMediaManager.model.get('localAudioStream');
        var newVideoStream          = this.localMediaManager.model.get('localVideoStream');
        var callState               = this.model.get('callState');

        this.peerConnectionManager.updatePeerStream({
            newVideoStream      : newVideoStream,
            newAudioStream      : newAudioStream
        });
    },

    onLocalStreamSuccessCB: function(streams) {
        var self                    = this;
        var newVideoStream          = null;
        var newAudioStream          = null;
        var currentVideoStream      = self.model.get('localVideoStream');
        var currentAudioStream      = self.model.get('localAudioStream');
        var callState               = this.model.get('callState');

        _.each(streams, function(stream, i,list) {
            if(stream.getVideoTracks().length > 0){
                newVideoStream   = stream;
                self.model.set('localVideoStream',newVideoStream);
            }
            else{
                newAudioStream = stream;
                self.model.set('localAudioStream',newAudioStream);
            }
        });
        // RENEGOTIATE
        if(callState === this.BJ_CALLSTATES.CONNECTED) {
            self.peerConnectionManager.updatePeerStream({
                    currentVideoStream  : currentVideoStream,
                    newVideoStream      : newVideoStream,
                    currentAudioStream  : currentAudioStream,
                    newAudioStream      : newAudioStream
                    });
        }

    },

    onReceiveConnectResponse: function() {
        this._applyCachedMuteStates();
        this.peerConnectionManager.signallingChannelCreated();
        this.localMediaManager.sendDeviceInfo();
    },

    onCallDisconnected: function(params) {
        RTCStateManager.callDisconnected(params);
    },

    onRequestTimeout: function() {
        RTCStateManager.callDisconnected(RTCErrors.DISCONNECT_REASONS.REQ_TIMED_OUT);
    },

    endCall: function() {
        this.sendDisconnectMessage(RTCErrors.DISCONNECT_REASONS.USER_INITIATED);
        this.localMediaManager.close();
        this.reset();
    },

    reset: function() {
        //Wait for call to get cleared and then go ahead
        var deferred = Q.defer();
        this.peerConnectionManager.close();
        RTCScreenSharingManager.close();
        RTCTransactionManager.reset();
        RTCStateManager.reset();
        this.model.set(RTCCallStateModel.defaults);
        this.internalModel.set(RTCPrivateModel.defaults);
        deferred.resolve();
        return deferred.promise;
    },

    sendDisconnectMessage: function(disconnectParams) {
        var disconnectMsg = RTCBlueJay.getDisconnectMessage(disconnectParams);
        RTCTransactionManager.onBlueJayRequest(disconnectMsg);
        RTCSignallingManager.sendMsg(disconnectMsg);
    },

    closeSocket: function() {
        Logger.debug("RTCController closing socket");
        RTCSignallingManager.close();
    },

    getVersion: function() {
        return "1.0"; // TO-DO: Can this be fetched from bower.json?
    },

    startScreenSharing: function (params) {
        RTCScreenSharingManager.startScreenSharing(params);
    },

    stopScreenSharing: function () {
        RTCScreenSharingManager.stopScreenSharing();
    },

    onLocalContentStreamChanged: function (model) {
        var contentStream = model.get('localContentStream');
        if(this.isFirefox) {
            this.peerConnectionManager.updateContentStream(contentStream);
        } else {
        if(contentStream) {
            this.peerConnectionManager.addPeerStream(contentStream);
        } else {
            contentStream = this.model.get('localContentStream');
            contentStream && this.peerConnectionManager.removePeerStream(contentStream);
        }}
        this.model.set('localContentStream', model.get('localContentStream'));
    },

    onPresentationTokenStatusChanged: function(model) {
        this.model.set('presentationTokenStatus', model.get('tokenStatus'));
    },

    triggerFirefoxScreenShareCancelled: function(model) {
        this.model.trigger('change:presentationTokenStatus', this.model);
    },

    onExtensionStatusChanged: function(model) {
        this.model.set('extensionStatus', model.get('extensionStatus'));
    },

    wsConnectionStateChange: function(state, socketId) {
        var oldWsSock = this.internalModel.get('wsConnectionState');
        this.internalModel.set('wsConnectionState', state);
        switch(state) {
            case this.WS_STATES.CONNECTED :
                // New Socket is created, start the new connection flow
                if (RTCStateManager.getCurrentCallState() === this.BJ_CALLSTATES.IDLE ||
                        oldWsSock !== this.WS_STATES.RECONNECTED)
                    this.initializePeerConnection();
                break;
            case this.WS_STATES.RECONNECTED :
                var oldSockId = this.internalModel.get('wsSocketId');
                if ((oldSockId !== socketId) &&
                    (RTCStateManager.getCurrentCallState() === this.BJ_CALLSTATES.RESTART_MEDIA)) {
                    //TODO :: Change the connection state logic
                    this.restartMediaChannel();
                }
                this.peerConnectionManager.sendKeepAliveMessage(true);
                if (this.resendMute) {
                    this._applyCachedMuteStates();
                }
                break;
            case this.WS_STATES.FAILED:
                RTCStateManager.callDisconnected(RTCErrors.DISCONNECT_REASONS.TRANSPORT_FAIL);
                break;
            case this.WS_STATES.DISCONNECTED:
            case this.WS_STATES.CLOSED:
            default:
                break;
        }
        this.internalModel.set('wsSocketId', socketId);
    },

    onIceConnectivityTimeout: function() {
        RTCStateManager.callDisconnected(RTCErrors.DISCONNECT_REASONS.TRANSPORT_FAIL);
    },

    setPresentationRatio: function(splitRatio) {
        RTCScreenSharingManager.sendPresentaionRatio(splitRatio);
    },

    onIceConnectivityClosed: function() {
        Logger.debug("RTCController :: Ice connection is closed, ending the call");
        RTCStateManager.callDisconnected(RTCErrors.DISCONNECT_REASONS.USER_INITIATED);
        this.localMediaManager.close();
    }

});

module.exports = RTCController;
