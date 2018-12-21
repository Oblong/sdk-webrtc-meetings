var Q 					       = require('q');
var my   				       = require('myclass');
var _       			     = require('underscore');
var Backbone 			     = require('backbone');
var Logger				     = require('Logger');
var Adapter				     = require('webrtc-adapter');
var RTCErrors          = require('./rtc-error');
var RTCBlueJay 			   = require('./rtc-bluejay');
var RTCCallStats       = require('./rtc-call-stats');
var RTCStates          = require('./rtc-states');
var RTCUtils           = require('./rtc-utils');
var PeerModel          = require('./rtc-peer-model');
var RTCStateManager    = require('./rtc-state-manager');
var SDPUtils           = require('sdpUtils');
var SDPInterop         = require('./sdp-interop/index');
var BrowserDetector    = require('browserDetector');

var RTCPeer = my.Class({

    iceRestartTimer: null,
    iceRestartTimeout: 10000, //trigger an ICE restart if iceConnectionState doesn't move from 'disconnected' to 'completed' in this timeout period
    iceConnectivityTimeout: 20000,
    iceConnectivityTimer: null,
    numIceCandidates: 0,

    constructor: function(options) {
        _.bindAll(this);
        _.extend(this, Backbone.Events);

        this.isFirefox = BrowserDetector.browser === 'firefox' ? true : false;
        this.ICE_CONNECTION_STATES = RTCStates.WEBRTC_STATES.iceConnectionState;

        var peerConfig = RTCUtils.deepMergeObjects(PeerModel.getDefaults(), options.peerConfig);
        this.model = new PeerModel(peerConfig);

        //FF specific changes
        this.isConnectionLost = false;
        this.oldPktCount = 0;
        this.maxPktRecvCounter = 5;
        this.pktRecvCounter = this.maxPktRecvCounter;
        this.isClosing = false;
        this.isRemoteMute = false;

        var peerConnectionConfig = this.model.get('peerConnectionConfig');
        var peerConnectionConstraints = this.model.get('peerConnectionConstraints');

        //create via adapter.js API
        //if (peerConnectionConfig.forceTurn) {
            Logger.debug("RTCPeer: Force turn is enabled, get only relay ICE candidates");
            peerConnectionConfig.iceTransportPolicy = "relay";
        //}

        if (peerConnectionConfig.webrtcDisableBundling && !this.isFirefox) {
            Logger.debug("RTCPeer: Disable ICE bundling");
            peerConnectionConfig.bundlePolicy = "balanced";
            this.bundlePolicy = "balanced";
        } else {
            this.bundlePolicy = "max-bundle";
        }

        //Append ICE Server username for Firefox
        if (this.isFirefox) {
            peerConnectionConfig.iceServers.forEach(function(icesvr){
                icesvr.username = icesvr.username + "#firefox";
            });
        }

        this.pc = new RTCPeerConnection(peerConnectionConfig, peerConnectionConstraints);
        this.pc.onicecandidate = this.onIceCandidate;
        this.pc.onaddstream = this.onRemoteStreamAdded;
        this.pc.onremovestream = this.onRemoteStreamRemoved;
        this.pc.onsignalingstatechange = this.onSignalingStateChanged;
        this.pc.oniceconnectionstatechange = this.onIceConnectionStateChanged;
        this.pc.onicegatheringstatechange = this.onIceGatheringStateChanged;
        this.pc.onnegotiationneeded = this.onNegotiationNeeded;

        if(!_.isNull(options.localAudioStream) && !_.isUndefined(options.localAudioStream)) {
            this.addStream(options.localAudioStream);
        }
        if(!_.isNull(options.localVideoStream) && !_.isUndefined(options.localVideoStream)) {
            this.addStream(options.localVideoStream);
        }

        if(!_.isNull(options.fakeStream) && !_.isUndefined(options.fakeStream)) {
            this.addStream(options.fakeStream);
        }

        this.callStats = new RTCCallStats({
              peerConnection: this.pc,
              statsPollInterval: this.isFirefox ? 1000 : this.model.get('statsPollInterval')
        });
        this.callStatsModel = this.callStats.model;
        this.callStats.on('rtcstats', this.checkFFMediaConnectivity);

        if (this.isFirefox)
            this.sdpInterop = new SDPInterop.Interop();

        this.webrtcFec = peerConnectionConfig.webrtcFec;
    },

    addStream: function(stream) {
        if(this.isPCClosed()) {
            Logger.warn('RTCPeer: Peer connection is closed, ignoring addStream request');
            return RTCErrors.PEER_CONNECTION_ERRORS.PC_CLOSED;
        } else {
            this.pc.addStream(stream);
            this.model.setStreamByType(stream, 'local', stream);
            Logger.debug('RTCPeer: Added stream to peer connection: ', stream.id);
        }
    },

    removeStream: function(stream) {
        if(this.isPCClosed()) {
            Logger.warn('RTCPeer: Peer connection is closed, ignoring removeStream request');
            return RTCErrors.PEER_CONNECTION_ERRORS.PC_CLOSED;
        } else {
            this.pc.removeStream(stream);
            this.model.setStreamByType(stream, 'local', null);
            Logger.debug('RTCPeer: Removed stream from peer connection: ', stream.id);
        }
    },

    removeAudioStream: function() {
        var localAudioStream = this.model.get('localAudioStream');
        if(!_.isNull(localAudioStream) && !_.isUndefined(localAudioStream)) {
            this.removeStream(localAudioStream);
        } else {
            Logger.debug('RTCPeer: Local Audio Stream in PC is null, cannot remove');
        }
    },

    removeVideoStream: function() {
        var localVideoStream = this.model.get('localVideoStream');
        if(!_.isNull(localVideoStream) && !_.isUndefined(localVideoStream)) {
            this.removeStream(localVideoStream);
        } else {
            Logger.debug('RTCPeer: Local Video Stream in PC is null, cannot remove');
        }
    },

    /* ============================= */
    /*        PC Event Handlers  	 */
    /* ============================= */

    onIceCandidate: function(event) {
        var candidate = event.candidate;
        if(candidate) {
            this.model.set('iceGatheringState', this.pc.iceGatheringState);
            //Logger.debug("RTCPeer: Got an ICE Candidate: " + JSON.stringify(candidate) + " but useTrickleICE is false, so not doing anything.");
            this.trigger('iceCandidate', this, candidate);
            this.numIceCandidates++;
        } else if (candidate === null) {
            if(this.numIceCandidates === 0 ) {
                // We have received only a null candidate till now, wait for 5 secs before terminating the call
                Logger.debug('RTCPeer :: Received NULL Ice Candidate before gathering candidates');
                this.onIceGatheringFailure();
            } else {
                Logger.debug("RTCPeer: Ice Gathering complete, Ice Candidate count " + this.numIceCandidates);
                this.model.set('iceGatheringState', this.pc.iceGatheringState);
            }
        }
    },

    onIceConnectionStateChanged: function(event) {
        if(this.pc) {
            this.model.set('iceConnectionState', this.pc.iceConnectionState);
            Logger.debug("RTCPeer: iceConnectionState changed to: " + this.pc.iceConnectionState);
            switch (this.pc.iceConnectionState) {
                case this.ICE_CONNECTION_STATES.CHECKING :
                    this.initIceConnectivityTimer();
                    break;
                case this.ICE_CONNECTION_STATES.CONNECTED :
                case this.ICE_CONNECTION_STATES.COMPLETED :
                    this.initCallStats();
                    this.clearIceConnectivityTimer();
                    break;
                case this.ICE_CONNECTION_STATES.DISCONNECTED :
                    this.initIceRestart();
                    this.initIceConnectivityTimer();
                    break;
                case this.ICE_CONNECTION_STATES.FAILED :
                    if(this.isFirefox)
                    {
                        Logger.warn("ICE connection failed, restarting the call");
                        RTCStateManager.callDisconnected(RTCErrors.DISCONNECT_REASONS.ICE_CONNECTION_FAILED);
                    }else{
                        this.initIceConnectivityTimer();
                        this.restartIce();
                    }
                    break;
                case this.ICE_CONNECTION_STATES.CLOSED:
                    if(!this.isPCClosed())
                        this.trigger('iceConnectionClosed');
                    break;
                default : break;
            }
        }
    },

    ffIceConnectionChange: function(state) {
        if(this.pc) {
            this.model.set('iceConnectionState', state);
            if(state === this.ICE_CONNECTION_STATES.CONNECTED) {
                this.clearIceConnectivityTimer();
            } else {
                this.initIceRestart();
                this.initIceConnectivityTimer();
            }
        }
    },

    initIceRestart: function() {
        var self = this;
        var state = this.model.get('iceConnectionState');
            this.iceRestartTimer = window.setTimeout(function() {
                state = self.model.get('iceConnectionState');
            if(state === self.ICE_CONNECTION_STATES.CONNECTED ||
                state === self.ICE_CONNECTION_STATES.COMPLETED) {
                self.clearIceRestartTimer();
            } else {
                    self.restartIce();
                }
            }, this.iceRestartTimeout);
    },

    restartIce: function() {
        this.trigger('restartICE');
        this.clearIceRestartTimer();
        this.isConnectionLost = false;
    },

    initIceConnectivityTimer: function() {
        var self = this;
        if (self.iceConnectivityTimer === null) {
            self.iceConnectivityTimer = setTimeout( function() {
                var state = self.model.get('iceConnectionState');
                if (state !== self.ICE_CONNECTION_STATES.CONNECTED &&
                    state !== self.ICE_CONNECTION_STATES.COMPLETED) {
                    Logger.warn("Can not establish ICE connectivity, restarting the call");
                    if(self.numIceCandidates === 0) {
                        RTCStateManager.callDisconnected(RTCErrors.DISCONNECT_REASONS.ICE_GATHERING_FAILED);
                    } else {
                        RTCStateManager.callDisconnected(RTCErrors.DISCONNECT_REASONS.ICE_CONNECTION_FAILED);
                    }
                }
            }, self.iceConnectivityTimeout);
        }
    },

    clearIceRestartTimer: function() {
        this.iceRestartTimer && window.clearTimeout(this.iceRestartTimer);
        this.iceRestartTimer = null;
    },

    clearIceConnectivityTimer: function() {
        this.iceConnectivityTimer && window.clearTimeout(this.iceConnectivityTimer);
        this.iceConnectivityTimer = null;
    },

    onIceGatheringStateChanged: function(event) {
        Logger.debug("RTCPeer: Received 'iceGatheringStateChange' event");
    },

    onNegotiationNeeded: function(event) {
        //Logger.debug("RTCPeer: Received 'negotiationNeeded' event");
    },

    onSignalingStateChanged: function(event) {
        if (this.pc) {
            Logger.debug("RTCPeer: signalingState changed to: " + this.pc.signalingState);
            this.model.set('signalingState', this.pc.signalingState);
            if(this.pc.signalingState === 'closed' && !this.isClosing)
                RTCStateManager.callDisconnected(RTCErrors.DISCONNECT_REASONS.SIG_CHANNEL_CLOSED);
        }
    },

    onIceCandidatesEnded: function() {
        Logger.debug("RTCPeer: Received 'endOfCandidates' event");
    },

    onRemoteStreamAdded: function(event) {
        var remoteStream = event.stream;

        if(!_.isNull(remoteStream) && !_.isUndefined(remoteStream)) {
            this.model.setStreamByType(remoteStream, 'remote', remoteStream);
            Logger.debug('RTCPeer: Connector added a stream to peer connection: ', remoteStream);
        } else {
            Logger.error('RTCPeer: onRemoteStreamAdded event has invalid stream in it: ', remoteStream);
        }
    },

    onRemoteStreamRemoved: function(event) {
        var remoteStream = event.stream;

        if(!_.isNull(remoteStream) && !_.isUndefined(remoteStream)) {
            this.model.setStreamByType(remoteStream, 'remote', null);
            Logger.debug('RTCPeer: Connector removed a stream from peer connection: ', remoteStream);
        } else {
            Logger.error('RTCPeer: onRemoteStreamRemoved event has invalid stream in it: ', remoteStream);
        }
    },

    initCallStats: function() {
        this.callStats.startPollingStats();
    },

    /*
        Hack to detect media disconnects on FF.
        Since FF does not trigger Ice state disconnected on temporary media disconnections,
        Compute the number of inbound packets on firefox for all the inboundrtp channels,
        to detect media connectivity. If the rtp packets are not updated for 5 consecutive
        intervals. Trigger "disconnected" event indicating ICE disconnect, as soon as rtp packets
        conunter is updated after a disconnected event, trigger "connected" event.
    */
    checkFFMediaConnectivity: function(stats) {
        var is = function is(stat, type) {
            return stat.type == type && !stat.isRemote;
        };

        if(this.isRemoteMute || this.model.get('iceConnectionState') !== 'connected')
        {
            //Do not check for inbound rtp packets
            return;
        }

        var newPktCount = 0;
        Object.keys(stats).find(function (key) {
            if(is(stats[key], "inboundrtp")){
                newPktCount = newPktCount + stats[key].packetsReceived;
            }
        });

        var isPktRecv = newPktCount - this.oldPktCount ? true : false;
        if(isPktRecv) {
            //reset the pkt recv counter
            this.pktRecvCounter = this.maxPktRecvCounter;

            //If the ep start receiving the packets again after a ICE disconnect
            //trigger ICE connected event and reset the flag.
            if(this.isConnectionLost){
                this.isConnectionLost = false;
                this.ffIceConnectionChange('connected');
                Logger.debug("RTCPeer :: ICE connected");
            }
        } else {
            if(this.pktRecvCounter) {
                //Connection is not down yet
                this.pktRecvCounter--;
            } else {
                //Media connection is lost, trigger ICE disconnected event
                //Do not trigger it every time when stats are not updated
                if(!this.isConnectionLost) {
                    this.ffIceConnectionChange('disconnected')
                    this.isConnectionLost = true;
                    Logger.debug("RTPeer :: ICE disconnected");
                }
            }
        }
        this.oldPktCount = newPktCount;
    },

    /* ====================================== */
    /*       Signalling Message Handlers      */
    /* ====================================== */

    handleResponseMessage: function(message) {
        //Logger.debug("RTCPeer: Received 'response' message: " + message);
        // Nothing to be done here for now
    },

    handleErrorMessage: function(message) {
        Logger.debug("RTCPeer: Received 'error' message: " + message);
        // Nothing to be done here for now
    },

    handleNotificationMessage: function(message) {
        Logger.debug("RTCPeer: Received 'notification' message: " + message);
        var methods = RTCBlueJay.METHODS;

        switch(message.method) {

            case methods.CANDIDATE:
                this.pc.processIce(message.iceCandidate);
                break;

            default:
                Logger.error("RTCPeer: Method received in notification message: " + message.method + " is not supported.");
        }
    },

    createOffer: function(params) {
        var self = this;
        var deferred = Q.defer();
        if(!this.isFirefox)
            var offerParams = _.extend({}, this.model.get('receiveMedia'), params);
        else
            var offerParams = params;

        //Reset the numIceCandidates timer on ICE restart
        if (offerParams && offerParams.iceRestart)
        {
            this.numIceCandidates = 0;
        }

        var onSuccess = function(offerSdp) {
            //Do not remove FEC and RED from SDP if webrtc fec support is enabled
            //Do not enable it for Firefox and Chrome 47 and lower
            if(!self.webrtcFec || self.isFirefox || BrowserDetector.version < "48") {
                if(BrowserDetector.version < "51" && !self.isFirefox)
                {
                    offerSdp.sdp = SDPUtils.maybeRemoveCodecFromSDP(offerSdp.sdp,'98');
                    offerSdp.sdp = SDPUtils.maybeRemoveCodecFromSDP(offerSdp.sdp,'116');
                } else {
                    offerSdp.sdp = SDPUtils.maybeRemoveVideoFec(offerSdp.sdp,{videoFec: 'false'} );
                }
            }
            self.pc.setLocalDescription(offerSdp, function() {

                if (self.isFirefox) {
                    offerSdp = self.sdpInterop.toPlanB(offerSdp);
                    offerSdp.sdp = SDPUtils.maybeReplaceVideoPortNumber(offerSdp.sdp, 9);
                }

                offerSdp = self._appendInfoToSdp(offerSdp);
                self.model.set('localSdp', offerSdp);
                deferred.resolve(offerSdp);
            }, function(error) {
                Logger.error("RTCPeer: Error while setting localSdp: " + error);
                deferred.reject(error);
            });
        };
        var onFailure = function(error) {
            Logger.error("RTCPeer: Error while creating offer sdp: " + error);
            deferred.reject(error);
        };

        if(this.isPCClosed()) {
            Logger.warn('RTCPeer: Peer connection is closed, ignoring createOffer request');
            deferred.reject(RTCErrors.PEER_CONNECTION_ERRORS.PC_CLOSED);
        } else {
            this.pc.createOffer(onSuccess, onFailure, offerParams);
        }

        return deferred.promise;
    },

    handleOffer: function(message) {
        var self = this;
        var offerSdp = message.params.sessionDescription;
        var deferred = Q.defer();

        var onFailure = function(error) {
            Logger.error("RTCPeer: Error while processing incoming offer request: " + error);
            deferred.reject(error);
        };

        if(this.isPCClosed()) {
            Logger.warn('RTCPeer: Peer connection is closed, ignoring handleOffer request');
            deferred.reject(RTCErrors.PEER_CONNECTION_ERRORS.PC_CLOSED);
        } else {
            this.pc.setRemoteDescription(new RTCSessionDescription(offerSdp), function() {

                self.model.set('remoteSdp', offerSdp);

                self.pc.createAnswer( function(answerSdp) {
                    self.pc.setLocalDescription( answer, function() {
                        // send the answer to the remote connection
                        answerSdp = self._appenInfotoSdp(answerSdp);
                        self.model.set('localSdp', answerSdp);
                        deferred.resolve();
                    }, onFailure);
                }, onFailure);
            }, onFailure);
        }

        return deferred.promise;
    },

    handleAnswer: function(message) {
        var self = this;
        var answerSdp = message.params.sessionDescription;
        var deferred = Q.defer();

        if(this.isPCClosed()) {
            Logger.warn('RTCPeer: Peer connection is closed, ignoring handleAnswer request');
            deferred.reject(RTCErrors.PEER_CONNECTION_ERRORS.PC_CLOSED);
        } else {

            if (this.isFirefox)
                answerSdp = this.sdpInterop.toUnifiedPlan(answerSdp);

            this.pc.setRemoteDescription(new RTCSessionDescription(answerSdp), function() {
                self.model.set('remoteSdp', answerSdp);
                deferred.resolve();
            }, function(error) {
                Logger.error("RTCPeer: Error while setting remote description: " + error);
                deferred.reject(error);
            });
        }

        return deferred.promise;
    },

    handleUpdate: function(message) {
        // TO-DO: Handling Updates to previously negotiated SDP
        var deferred = Q.defer();
        Logger.warn("RTCPeer: 'update' Method is not supported yet");
        deferred.resolve();
        return deferred.promise;
    },

    handleKeepAlive: function(message) {
        Logger.debug("RTCPeer: Received a keepalive message");
        // TO-DO: Peer should have a keep-alive timer, and it should validate against it whether the remote is sending keep-alives
        // within the timeout threshold or not
        var deferred = Q.defer();
        deferred.resolve();
        return deferred.promise;
    },

    handleDisconnect: function(message) {
        var deferred = Q.defer();
        if(!this.pc) {
            Logger.warn("RTCPeer: This Peer Connection has already been closed!!");
        } else {
            this.isClosing = true;
            if (this.pc.signalingState !== "closed")
                this.pc.close();
            this.model.set(PeerModel.getDefaults());
            this.pc = null;
        }
        deferred.resolve();
        return deferred.promise;
    },

    handleIceCandidate: function(message) {
        var deferred = Q.defer();

        if (this.isFirefox) {
            if (message.sdpMid === 'audio')
                message.sdpMid = 'sdparta_0';
            else {
                message.sdpMid = 'sdparta_1';
                message.sdpMLineIndex = 1;
            }
        }

        if(this.pc) {
            var candidate = new RTCIceCandidate({
                sdpMLineIndex: message.sdpMLineIndex,
                candidate: message.candidate,
                sdpMid: message.sdpMid
            });

            this.pc.addIceCandidate(candidate);
            deferred.resolve();
        }
        return deferred.promise;
    },

    isPCClosed: function() {
        if (this.model.get('closed') === true || this.pc.signalingState === 'closed')
            return true;
        else
            return false;
    },

    _appendInfoToSdp: function(desc){
        var streamInfo = new Object({
            'audioMsid': "",
            'videoMsid': "",
            'contnetMsid': ""
        });

        this.pc.getLocalStreams().forEach(function(stream){

            switch(stream.bjn_label){
                case "local_av_stream":
                    streamInfo['audioMsid'] = stream.id;
                    streamInfo['videoMsid'] = stream.id;
                    break;
                case "local_audio_stream":
                    streamInfo['audioMsid'] = stream.id;
                    break;
                case "local_video_stream":
                    streamInfo['videoMsid'] = stream.id;
                    break;
                case "content_stream":
                case "fake_stream":
                    streamInfo['contentMsid'] = stream.id;
                    break;
                  default:
                      Logger.error('RTCPeer: Invalid Stream found in PC ' +stream.bjn_label);
            }
        });

        desc.streamInfo = streamInfo;

        return desc;
    },

    onIceGatheringFailure: function() {
        var self = this;
        window.setTimeout(function(){
            if(self.numIceCandidates === 0) {
                Logger.warn('RTCPeer :: Received only NULL Ice Candidate before gathering candidates, Restarting the call');
                RTCStateManager.callDisconnected(RTCErrors.DISCONNECT_REASONS.ICE_GATHERING_FAILED);
            }
        }, 5000);
    },

    replaceTrack: function(trackType, newStream) {
        var self = this;
        var oldStream = null;

        if (trackType === 'audio' || trackType === 'video') {
            oldStream = trackType === 'audio' ? this.model.get('localAudioStream') : this.model.get('localVideoStream');
        } else {
            //Handle content stream changes seperately
            if(newStream){
                //New Content stream, set the peer model value
                this.model.setStreamByType(newStream, 'local', newStream);
                oldStream = this.model.get('fakeStream');
            } else {
                oldStream = this.model.get('localContentStream');
                newStream = this.model.get('fakeStream');
                this.model.setStreamByType(oldStream, 'local', null);
            }
        }

        if(!_.isNull(oldStream) && !_.isUndefined(oldStream) && this.pc) {
            if(oldStream.id !== newStream.id) {
                var oldTrack = oldStream.getTracks()[0].id;
                this.pc.getSenders().forEach(function(rtcRtpSender) {
                    if(rtcRtpSender && rtcRtpSender.track.id === oldTrack) {
                        rtcRtpSender.replaceTrack(newStream.getTracks()[0]);
                        self.model.setStreamByType(newStream, 'local', newStream);
                    }
                });
            }
        } else {
            Logger.debug('RTCPeer: Local Stream in PC is null, cannot replace the track');
        }
    },

    close: function() {
        Logger.debug('RTCPeer: closing RTCPeerConnection now');
        this.isClosing = true;
        this.clearIceConnectivityTimer();
        this.clearIceRestartTimer();
        this.handleDisconnect();
        this.callStats.close();
        this.numIceCandidates = 0;
    },
});

module.exports = RTCPeer;
