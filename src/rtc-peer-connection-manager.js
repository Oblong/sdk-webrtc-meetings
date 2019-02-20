/*
* Blue Jeans WebRTC Peer Connection Manager
* =====================================================================================
* @version In bower.json
*
*/

var Q                       = require('q');
var my                      = require('myclass');
var _                       = require('underscore');
var Backbone                = require('backbone');
var Logger                  = require('Logger');
var RTCPeer                 = require('./rtc-peer');
var RTCBlueJay              = require('./rtc-bluejay');
var RTCStates               = require('./rtc-states');
var SDPUtils                = require('sdpUtils');
var RTCStateManager         = require('./rtc-state-manager');
var RTCSignallingManager    = require('./rtc-signalling-manager');
var RTCTransactionManager   = require('./rtc-transaction-manager');
var RTCScreenSharingManager = require('./rtc-screensharing-manager');
var RTCErrors               = require('./rtc-error');
var BrowserDetector         = require('browserDetector');

var RTCPeerConnectionManager = my.Class({
    config: {
        keepAliveMaxFailures: 6,
        keepAliveConnectorfailure: 2,
        sdpParams: {
            videoRecvBitrate: 1200
        }
    },

    peer: null,
    offerInProgress: false,
    createOfferQueued: false,
    keepAliveTimer: null,
    keepAliveFailedAttempts: 0,
    isSignallingChannelReady: false,

    constructor: function(params) {
        _.bindAll(this);
        _.extend(this.config, params);
        _.extend(this, Backbone.Events);
        this.BJ_CALLSTATES = RTCStates.BJ_CALLSTATES;
        this.WEBRTC_STATES = RTCStates.WEBRTC_STATES;
        RTCSignallingManager.setupMessageParser(this.getSignallingCallbacks());
        this.iceCandidates = [];
        this.isSignalingChannelReady = false;
        RTCTransactionManager.on('receivedConnectResponse', this.onReceiveConnectResponse);
        RTCTransactionManager.on('receivedKeepAliveResponse', this.onKeepAliveResponse);
    },

    createPeer: function(params) {
        this.peer = new RTCPeer(params);
        this.peer.on('iceCandidate', this.onNewIceCandiate);
        this.peer.model.on('change:iceGatheringState', this.onIceGatheringStateChanged);
        this.peer.model.on('change:iceConnectionState', this.onIceConnectionStateChange);
        this.peer.model.on('change:signalingState', this.onSignalingStateChange);
},

    getPeer: function() {
        return this.peer;
    },

    updateMeetingParams: function(params) {
        this.meetingParams = params;
        if (this.meetingParams.maxBandwidth) {
            var bitrate = window.parseInt(this.meetingParams.maxBandwidth, 10);
            // Min allowed bit rate 100kpbs, Max allowed bitrate 4096 kpbs
            if (bitrate >= 100 && bitrate <= 4096){
                this.config.sdpParams.videoRecvBitrate = this.meetingParams.maxBandwidth;
                Logger.debug("RTCPeerConnectionManager :: Updating max session bitrate to - "
                    + this.config.sdpParams.videoRecvBitrate);
            } else {
                Logger.debug("RTCPeerConnectionManager :: received invalid max bitrate " + bitrate
                        + ", using default value");
            }
        } else {
            Logger.debug("RTCPeerConnectionManager :: using default max session bitrate - "
                + this.config.sdpParams.videoRecvBitrate );
        }
    },

    signallingChannelCreated: function()
    {
        this.initKeepAliveMessage();
        this.sendKeepAliveMessage(false);
        this.isSignalingChannelReady = true;
        this.enqueueIceCandidates();
    },

    initiateCall: function(params, isCallInit) {
        var self = this;
        this.iceCandidates = [];

        this.createOffer(params).then(function(offerSdp) {
            var callState = RTCStateManager.getCurrentCallState();
            if(callState === self.BJ_CALLSTATES.CONNECTING || callState === self.BJ_CALLSTATES.INITIALISING || callState === self.BJ_CALLSTATES.IDLE ) {
                self.sendConnectMessage(offerSdp);
            } else if (callState === self.BJ_CALLSTATES.RECONNECTING || callState === self.BJ_CALLSTATES.REINITIALISING) {
                self.sendUpdateMessage(offerSdp);
            }
        }, function(error) {
            Logger.error("RTCPeerConnectionManager: Error while creating offerSdp, reconnecting the call");
            RTCStateManager.callDisconnected(RTCErrors.DISCONNECT_REASONS.SIG_CHANNEL_CLOSED);
            throw error;
        });
    },

    sendIceCandidate: function(iceCandidate) {
        if (iceCandidate) {

            if (BrowserDetector.browser === 'firefox') {
                if (iceCandidate.sdpMid === 'sdparta_0')
                      iceCandidate.sdpMid = 'audio';
                  else if (iceCandidate.sdpMid === 'sdparta_1' || iceCandidate.sdpMid === 'sdparta_2') {
                      iceCandidate.sdpMid = 'video';
                      iceCandidate.sdpMLineIndex = 1;
                }
            }

            var iceCandidateMsg = RTCBlueJay.getIceCandidateMessage(iceCandidate);
            RTCSignallingManager.sendMsg(iceCandidateMsg);
            RTCTransactionManager.onBlueJayRequest(iceCandidateMsg);
        }
    },

    enqueueIceCandidates: function()
    {
        var self = this;
        self.iceCandidates.forEach(function(iceCandidate) {
            self.sendIceCandidate(iceCandidate);
        });
    },

    onNewIceCandiate: function(peer, iceCandidate) {
            // send iceCandidate notification message
            if (this.isSignalingChannelReady === false)
            {
                this.iceCandidates.push(iceCandidate);
            } else {
                this.sendIceCandidate(iceCandidate);
            }
    },

    onIceGatheringStateChanged: function(model) {
        RTCStateManager.iceGatheringStateChange(model.get('iceGatheringState'));
    },

    onIceConnectionStateChange: function(model) {
        RTCStateManager.iceConnectionStateChange(model.get('iceConnectionState'));
    },

    onSignalingStateChange: function(model) {
        RTCStateManager.signalingStateChange(model.get('signalingState'));
    },

    handleResponseMessage: function(message) {
        var peer = this.getPeer();
        return peer.handleResponseMessage(message);
    },

    handleErrorMessage: function(message) {
        var peer = this.getPeer();
        return peer.handleErrorMessage(message);
    },

    handleNotificationMessage: function(message) {
        var peer = this.getPeer();
        return peer.handleNotificationMessage(message);
    },

    handleRequestMessage: function(message) {
        var methods = RTCBlueJay.METHODS;
        var peer = this.getPeer();

        switch(message.method) {

            case methods.CONNECT: return this.onConnect(peer, message); break;

            case methods.ANSWER: return this.onAnswer(peer, message); break;

            case methods.UPDATE: return this.onUpdate(peer, message); break;

            case methods.DISCONNECT: return this.onDisconnect(peer, message); break;

            case methods.KEEPALIVE: return this.onKeepAlive(peer, message); break;

            case methods.ICE: return this.onIceCandidate(peer, message); break;

            default:
                Logger.error("RTCPeerConnectionManager: Method received in message: " + message.method + " is not supported.");
        }
    },

    onConnect: function(peer, message) {
        return peer.handleOffer(message);
    },

    onAnswer: function(peer, message) {
        var self = this;

        message.params.sessionDescription.sdp = SDPUtils.maybeSetVideoReceiveBitRate(message.params.sessionDescription.sdp, self.config.sdpParams);

        return peer.handleAnswer(message).then(function() {

            self.offerInProgress = false;

            if(self.createOfferQueued) {
                Logger.debug("RTCPeerConnectionManager: Processing previously Queued 'update offer' request");
                self.createUpdateOffer();
                self.createOfferQueued = false;
            }
        });
    },

    onUpdate: function(peer, message) {
        return peer.handleUpdate(message);
    },

    onDisconnect: function(peer, message) {
        return peer.handleDisconnect(message);
    },

    onKeepAlive: function(peer, message) {
        return peer.handleKeepAlive(message);
    },

    onIceCandidate: function(peer, message) {
        return peer.handleIceCandidate(message.params.iceCandidate);
    },

    addPeerStream: function(stream) {
        var peer = this.getPeer();
        if(!peer) {
            Logger.warn('RTCPeerConnectionManager: RTCPeer does not exist, ignoring addStream API on it');
            return false;
        }
        peer.addStream(stream);
        this.createUpdateOffer();
        return true;
    },

updatePeerStream: function(params) {
        var peer = this.getPeer();
        if(!peer) {
            Logger.warn('RTCPeerConnectionManager: RTCPeer does not exist, ignoring updatePeerStream API on it');
            return false;
        }

        if(!_.isUndefined(params.newAudioStream) && !_.isNull(params.newAudioStream)){
            if (BrowserDetector.browser === 'firefox') {
                //FF support replaceTrack API to change the media track on the fly,
                //these is no need to remove and add the stream again.
                peer.replaceTrack('audio', params.newAudioStream);
            } else {
                // remove the currently negotiated local audio stream in peer connection
                peer.removeAudioStream();
                // add the new audio stream to the peer connection
                peer.addStream(params.newAudioStream);
            }
        }

        if(!_.isUndefined(params.newVideoStream) && !_.isNull(params.newVideoStream)){
            if (BrowserDetector.browser === 'firefox') {
                //FF support replaceTrack API to change the media track on the fly,
                //these is no need to remove and add the stream again.
                peer.replaceTrack('video', params.newVideoStream);
            } else {
                // remove the currently negotiated local video stream in peer connection
                peer.removeVideoStream();
                // add the new video stream to the peer connection
                peer.addStream(params.newVideoStream);
            }
        }

        // Do not send update message in case of Firefox
        if (BrowserDetector.browser !== 'firefox')
            this.createUpdateOffer();
},

    updateContentStream: function(stream)
    {
        var peer = this.getPeer();
        peer.replaceTrack('content', stream);
    },

    removePeerStream: function(stream) {
        var peer = this.getPeer();
        if(!peer) {
            Logger.warn('RTCPeerConnectionManager: RTCPeer does not exist, ignoring removeStream API on it');
            return false;
        }
        peer.removeStream(stream);
        this.createUpdateOffer();
        return true;
    },

    createUpdateOffer: function(params) {
        var self = this;

        // Do not create an update message before receiving the initial connect response
        if (this.isSignallingChannelReady === false) {
            this.createOfferQueued = true;
            return ;
        }
        this.createOffer(params).then(function(offerSdp) {
            self.sendUpdateMessage(offerSdp);
        }, function(error) {
            Logger.error('RTCPeerConnectionManager: RTCPeer failed to create "updated" offer');
        });
    },

    createOffer: function (params) {
        var peer = this.getPeer();
        var self = this;
        var deferred = Q.defer();
        var currentState = RTCStateManager.getCurrentCallState();

        if(this.offerInProgress) {
            this.createOfferQueued = true;
            Logger.debug("RTCPeerConnectionManager: Queing 'update offer' request. Current call state: ", currentState);
        } else {
            self.offerInProgress = true;
            peer.createOffer(params).then(function(offerSdp) {

            offerSdp.sdp = SDPUtils.maybeSetVideoReceiveBitRate(offerSdp.sdp, self.config.sdpParams);
            offerSdp.sdp = SDPUtils.maybeSetTrickleIceAttr(offerSdp.sdp);
            deferred.resolve(offerSdp);
            }, function(error) {
                self.offerInProgress = false;
                deferred.reject(error);
            });
        }

        return deferred.promise;
    },

    sendConnectMessage: function(offerSdp) {
        var connectMessage = RTCBlueJay.getConnectMessage({
                'sessionId'         : this.meetingParams.sessionId,
                'endpointProperties': this.meetingParams.endpointDetails,
                'sessionDescription': offerSdp,
                'streamInfo'        : offerSdp.streamInfo,
                'bundlingPolicy'    : this.peer.bundlePolicy
        });
        RTCTransactionManager.onBlueJayRequest(connectMessage);
        RTCSignallingManager.sendMsg(connectMessage);
    },

    sendUpdateMessage: function(offerSdp) {
        //var newSdp = this.peerConnectionManager.peer.model.get('localSdp');
        //this.internalState.set('localSdp', newSdp);
        var updateMessage = RTCBlueJay.getUpdateMessage({
                'sessionDescription': offerSdp,
                'streamInfo'        : offerSdp.streamInfo
        });

        RTCTransactionManager.onBlueJayRequest(updateMessage);
        RTCSignallingManager.sendMsg(updateMessage);
        //this._applyCachedMuteStates();
    },

    sendKeepAliveMessage: function(forceSend) {
        if (!forceSend || this.keepAliveFailedAttempts >= this.config.keepAliveMaxFailures - 1) {
                var keepAliveReq = RTCBlueJay.getKeepaliveMessage();
                RTCTransactionManager.onKeepaliveRequest(keepAliveReq.id);
                RTCSignallingManager.sendMsg(keepAliveReq);
        }
    },

    getSignallingCallbacks: function() {
        return {
            'request': this.onRequestMessage,
            'response': this.onResponseMessage,
            'error': this.onErrorMessage,
            'notification': this.onNotificationMessage,
            'invalidMessage': this.onInvalidMessage
        };
    },

    onRequestMessage: function(message) {
        var self = this;
        var responseMsg = RTCBlueJay.getSuccessResponse(message.id);
        if(_.isUndefined(RTCTransactionManager.lookupOutgoingResponse(message.id)))
        {
            if(message.method === RTCBlueJay.METHODS.TOKEN) {
                //TODO:: Change the below methods
                RTCScreenSharingManager.handleTokenMessage(message);
                RTCSignallingManager.sendMsg(responseMsg);
            } else {
                this.handleRequestMessage(message).then(function(response) {
                    RTCSignallingManager.sendMsg(responseMsg);
                    RTCTransactionManager.onOutgoingBlueJayResponse(message.id, responseMsg);
                    if(message.method === 'disconnect') {
                        RTCStateManager.callDisconnected(message.params);
                    }
                }, function(error) {
                    Logger.debug("RTCPeerConnectionManager :: Error while handling request message " + error);
                    var errorMsg = RTCBlueJay.getErrorResponse(message.id, RTCErrors.SIGNALING_ERRORS.BAD_REQUEST);
                    RTCSignallingManager.sendMsg(errorMsg);
                });
            }
        } else {
            RTCSignallingManager.sendMsg(responseMsg);
        }
    },

    onResponseMessage: function(message) {
        this.handleResponseMessage(message);
        RTCTransactionManager.onIncomingBlueJayResponse(message.id);
    },

    onErrorMessage: function(message) {
        this.handleErrorMessage(message);
        if (message.error.code === RTCErrors.SIGNALING_ERRORS.METHOD_NOT_IMPLEMENTED.code)
        {
            Logger.warn("RTCPeerConnectionManager :: Method not Implemented, Message :: "
                    + JSON.stringify(RTCTransactionManager.getRequestMessage(message.id)));
            return ;
        }

        RTCStateManager.callDisconnected(RTCErrors.DISCONNECT_REASONS.TRANSPORT_FAIL);
    },

    onNotificationMessage: function(message) {
        this.handleNotificationMessage(message);
    },

    onInvalidMessage: function(message, errorMsg) {
        var error = RTCBlueJay.getErrorResponse(message.id, errorMsg);
        RTCSignallingManager.sendMsg(error);
    },

    initKeepAliveMessage: function() {
        var self = this;
        self.keepAliveTimer = setInterval( function(){
            if(RTCTransactionManager.getKeepaliveMessageState() === 'finished'){
                self.sendKeepAliveMessage(false);
                self.keepAliveFailedAttempts = 0;
            }else {
                self.keepAliveFailedAttempts++;
                if ((self.keepAliveFailedAttempts == self.config.keepAliveConnectorfailure &&
                    RTCSignallingManager.WS_STATES === RTCStates.WS_STATES.CONNECTED) ||
                    self.keepAliveFailedAttempts >= self.config.keepAliveMaxFailures){
                    Logger.warn('RTCPeerConnectionManager: KeepAlive timeout has occurred, call will need to be reconnected!!');
                    RTCStateManager.callDisconnected(RTCErrors.DISCONNECT_REASONS.KEEPALIVE_TIMEOUT);
                } else {
                    self.sendKeepAliveMessage(false);
                }
            }
        }, RTCTransactionManager.config.keepaliveTimeout);
    },

    stopKeepAliveMessages: function() {
        this.keepAliveFailedAttempts = 0;
        clearInterval(this.keepAliveTimer);
    },

    onReceiveConnectResponse: function() {
        this.isSignallingChannelReady = true;
    },

    onKeepAliveResponse: function() {
        this.keepAliveFailedAttempts = 0;
    },

    reset: function() {
        this.close();
    },

    close: function() {
        var peer = this.getPeer();
        this.stopKeepAliveMessages();
        this.createOfferQueued = false;
        this.offerInProgress = false;
        this.isSignalingChannelReady = false;
        peer && peer.close();
    }
});

module.exports = RTCPeerConnectionManager;
