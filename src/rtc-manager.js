/*
* Blue Jeans WebRTC BJNRTCManager
* ==============================================================================
* Wrapper to control events between WebRTC SDK Client and BJN Seam API JS Lib
* @version In bower.json
*
*/

var my                      = require('myclass');
var _                       = require('underscore');
var Backbone                = require('backbone');
var Q                       = require('q');
var RTCController           = require('./rtc-controller');
var Logger                  = require('Logger');

var SecurePerimeterClient   = require("./client-sdk/clients/secure-perimeter-client");
var EVSC                    = require("./client-sdk/clients/event-service-client");
var SchedulingClient        = require("./client-sdk/clients/scheduling-client");
var BrowserDetector         = require('browserDetector');

var RTCManager = my.Class({

    constructor : function(params) {
        if(!(BrowserDetector.browser === "chrome" || BrowserDetector.browser === "firefox"))
        {
            Logger.error("Browser not supported !!");
            return;
        }
        this.EventServiceClient = EVSC();
        _.bindAll(this);
        _.extend(this, Backbone.Events);
        this.initialize(params);

        this.aggregateAPIResponse = null;
        this.meeting = null;
        this.reconnectInterval = 1000;
        this.bjnCloudTimeout = 5000;
        this.bjnSIPTimeout = 3000;
        this.bjnWebRTCReconnectTimeout = 90000;
        this.isVolumeMonitorStarted = false;
  this.maxBandwidth = 1200;
        this.config = {
            environment: {
                hostname: "https://bluejeansdev.com"
            },
            meeting : {
                meetingNumericId: "",
                attendeePasscode: ""
            },
            user: {
                name: "Testclient",
                leaderId: 14659,
                userToken: "186731bd52f8478090444d7c5862f7bd"
            },
            events: ["meeting", "endpoint"],
        }
    },

    initialize : function (params) {
          this.rtcController = new RTCController(params.webrtcParams);
          this.webrtcParams = params.webrtcParams;
          this.setupRTCControllerCB();
          this.setupRTCControllerListeners();
          // Set SIP and WebRTC EP timeouts, if they are not received in
          // params, use the default values
          if (params.bjnSIPTimeout) {
              this.bjnSIPTimeout = params.bjnSIPTimeout;
          }
          if (params.bjnWebRTCReconnectTimeout) {
              this.bjnWebRTCReconnectTimeout = params.bjnWebRTCReconnectTimeout;
          }
          if (params.bjnCloudTimeout) {
              this.bjnCloudTimeout = params.bjnCloudTimeout;
          }

          this.meetingInfo = null;

          //Init event handlers
          this.localEndPointStateChange  = null;
          this.remoteEndPointStateChange = null;
          this.remoteStreamChange        = null;
          this.remoteMuteChange          = null;
          this.localVideoStreamChange    = null;
          this.localAudioStreamChange    = null;
          this.error                     = null;
          //this.endMeeting                = null;
    this.fakeStream = null;
    this.contentStreamChange		= null;
          if(BrowserDetector.browser === "firefox") {
            this.createFakeStream();
        }
    },

    setBandwidth : function(bw){
    if((bw>=100) && (bw<=4096)){
        this.maxBandwidth = bw;
    }
    },

    getServiceClient: function() {
        return this.EventServiceClient;
    },

    setupRTCControllerCB : function() {
        this.getLocalMedia      = this.rtcController.getLocalMedia;
        this.getLocalDevices    = this.rtcController.getLocalDevices;
        this.setSpeaker         = this.rtcController.setSpeaker;
        this.renderSelfView     = this.rtcController.renderSelfView;
        this.renderStream       = this.rtcController.renderStream;
        this.muteStreams        = this.rtcController.muteStreams;
        this.makeCall           = this.rtcController.makeCall;
    },

    setupRTCControllerListeners : function() {
        this.rtcController.model.on('change:callState', this.onCallStateChange);
        this.rtcController.model.on('change:localAudioStream', this.onLocalAudioStreamChange);
        this.rtcController.model.on('change:localVideoStream', this.onLocalVideoStreamChange);
        this.rtcController.model.on('change:previewStream', this.onPreviewStreamChange);
        this.rtcController.model.on('change:remoteStream', this.onRemoteStreamChange);
        this.rtcController.model.on('change:isIceRestarted', this.onIceRestart);
  this.rtcController.model.on('change:presentationToken', this.onPresentationTokenUpdated.bind(this));
    },

    startMeeting: function(params) {
        var self = this;
        if(!params.numericMeetingId || !params.displayName)
        {
            if(this.error) {
                this.error('invalidMeetingParams');
            }
            Logger.error("Meeting id or display name cannot be empty");
            return;
        }
        this.getPairingCodeAndInitCall(params);
        this.initBJNCloudConnectionTimer();
    },

    WebRTCPairing:function(){
        var self = this;
        this.meeting.oauthInfo = this.aggregateAPIResponse.oauthInfo;

        SecurePerimeterClient.webRTCPairing(self.meeting, function (err, webRTCPairingResult) {
            if (err) {
                Logger.error(err);
                //self.error('bjnCloudUnreachable');
                //self.clearBJNCloudConnectionTimer();
                //self.endMeeting();
            } else {
                self.clearReconnectTimer();
                self.clearBJNCloudConnectionTimer();
                self.initWebRTCCall(JSON.parse(webRTCPairingResult));
                self.connectEventService(self.aggregateAPIResponse);
            }
        });
    },
    getPairingCodeAndInitCall : function(meetingParams) {
        //Add more params and function CBs
        var self = this;
        this.meetingInfo = meetingParams;
        self.meeting = {};
        self.meeting.meetingNumericId = meetingParams.numericMeetingId;
        if(meetingParams.attendeePasscode)
            self.meeting.meetingPasscode = meetingParams.attendeePasscode;

        SecurePerimeterClient.aggregatePairing(self.meeting, function (err, aggregateResult) {
            if (err) {
                Logger.debug("could not get response of aggregate Pairing ", err);
            } else {
                self.aggregateAPIResponse = JSON.parse(aggregateResult);
                Logger.debug("main: aggregatePairing response = ", self.aggregateAPIResponse);
                self.WebRTCPairing();
            }
        });
    },

    connectEventService: function(params) {
        var self = this;

        this.EventServiceClient.roster.collection.bind("add", function(participant, collection, options) {
            //Logger.debug("bind onAdd: " + participant.id + participant.attributes.name , participant);
            self.clearSipConnectionTimer();
            if(self.remoteEndPointStateChange)
                self.remoteEndPointStateChange('connected');
        });
        this.EventServiceClient.roster.collection.bind("change:isSendingAudio", function(participant, collection, options) {
            //Logger.debug("bind change:isSendingAudio " , participant.id + participant.attributes.name , participant);
        });
        this.EventServiceClient.roster.collection.bind("change:isSendingVideo", function(participant, collection, options) {
            //Logger.debug("bind change:isSendingVideo " , participant.id + participant.attributes.name , participant);
        });
        this.EventServiceClient.roster.collection.bind("remove", function(participant, collection, options) {
            //Logger.debug("bind onRemove: " , participant.id + participant.attributes.name , participant);
            if(self.remoteEndPointStateChange)
                self.remoteEndPointStateChange('disconnected');
        });

        this.EventServiceClient.connect(params, this.config, function(err, result){
            if (err)
            {
                Logger.debug("Event Service: connect error");
                if(self.error) {
                    Logger.error(err);
                    self.error('bjnCloudUnreachable');
                    self.clearBJNCloudConnectionTimer();
                    self.endMeeting();
                }
            }
        });
    },

    disconntEventService: function() {
        this.EventServiceClient.close();
    },

    /* Call Seam API with meeting id to generate access token
      * Make a pairing API call
      * meetingParams : {
        userName :
        numericMeetingId :
        attendeePassCode :
        webrtcLocalStream : App has to create using getLocalMedia
    } */

    initWebRTCCall : function (webrtcPairingRsp){
        Logger.debug("RTCManager :: WebRTC Pairing response ", JSON.stringify(webrtcPairingRsp));
        var callParams = {
            sockUrl : webrtcPairingRsp.uri,
            sessionId : webrtcPairingRsp.pairingCode,
            endpointDetails :  {
                displayName: this.meetingInfo.displayName,
                endpointType: "Browser",
                browserUserAgent: window.navigator.userAgent
            },
    maxBandwidth : this.maxBandwidth
          };

          var peerConfig = this.webrtcParams.peerConfig;
          peerConfig.peerConnectionConfig.iceServers = webrtcPairingRsp.turnservers;

          var peerParams = {
              peerConfig: peerConfig,
              localVideoStream: this.getMediaStream('localVideoStream'),
              localAudioStream: this.getMediaStream('localAudioStream')
          };
          if(BrowserDetector.browser === "firefox")
            peerParams.fakeStream = this.fakeStream;

          this.makeCall(peerParams, callParams);

      },

    stopLocalStreams: function() {
        var localVideoStream    = this.getMediaStream('localVideoStream');
        var localAudioStream    = this.getMediaStream('localAudioStream');

        if(!_.isNull(localAudioStream) && !_.isUndefined(localAudioStream)) {
            this.rtcController.stopLocalMedia(localAudioStream);
        }

        if(!_.isNull(localVideoStream) && !_.isUndefined(localVideoStream)) {
            this.rtcController.stopLocalMedia(localVideoStream);
        }
    },

    getMediaStream : function(streamType) {
        var stream = this.rtcController.model.get(streamType);
        if (stream) {
            return stream;
        } else {
            return null;
        }
    },

    getCurrentState: function(endpointType){
        if (endpointType === 'local') {
            return this.rtcController.model.get('callState');
        } else {
            return this.getRemoteCallState();
        }
    },

    getCurrentMuteStates: function(endpointType) {
        //this information can be retrived from the SEAM apis
        if (endpointType === 'local') {
            return {
                'audio' : this.rtcController.model.get('audioMuted'),
                'video' : this.rtcController.model.get('videoMuted')
            }
        }
    },

    // RTCContoller model change handlers
    onCallStateChange: function(model){
        var self = this;
        var callState = model.get('callState');
        switch(callState) {
            case 'connected' :
                this.clearWebrtcReconnectTimer();
                break;
            case 'disconnected' :
                //start the webrtc reconnection timer
                //reconnect the webrtc call
                var disconnectCode = this.rtcController.model.get('disconnectCode');
                if (disconnectCode/100 !== 2){
                    self.initReconnectTimer();
                    self.initWebrtcReconnectTimer();
                }
                break;
            default:
                break;
        }
        if(this.localEndPointStateChange)
            this.localEndPointStateChange(callState);
    },

    onRemoteStreamChange: function(model) {
        var remoteStream = model.get('remoteStream');
        if(this.remoteStreamChange && remoteStream)
            this.remoteStreamChange(remoteStream);
    },

    onLocalVideoStreamChange: function (model) {
        if(this.localVideoStreamChange)
            this.localVideoStreamChange(model.get('localVideoStream'));
    },

    onLocalAudioStreamChange: function(model) {
        if(this.localAudioStreamChange)
            this.localAudioStreamChange(model.get('localAudioStream'));
    },

onPresentationTokenUpdated: function(model){
  var token = model.get('presentationToken');
  if(token && token.type === 'contentindication'){
    if(this.isScreenShareOn && token.callGuid === "null") {
      // currently sharing, but want to end
      this.isScreenShareOn = false;
      this.onContentStreamUpdated(null);
    } else if(!this.isScreenShareOn && token.callGuid && token.callGuid !== "null") {
      // starting to share
      this.isScreenShareOn = true;
      var contentStream = model.get('remoteContentStream');
      if(contentStream)
        this.onContentStreamUpdated(contentStream);
    } else if(!this.isScreenShareOn && !token.callGuid) {
        // not sharing, and desire to end share
        this.onContentStreamUpdated(null);
    };
  }
},

onContentStreamUpdated: function(stream){
  if(this.contentStreamChange)
    this.contentStreamChange(stream);
},

    initWebrtcReconnectTimer: function() {
        var self = this;
        if (!self.webrtcReconnectTimer) {
            self.webrtcReconnectTimer = window.setTimeout(function() {
                if (self.getCurrentState('local') !== 'connected') {
                    if(self.error)
                        self.error('webrtcReconnectTimeout');
                    self.clearReconnectTimer();
                    self.endMeeting();
                }
            }, self.bjnWebRTCReconnectTimeout);
        }
    },

    clearWebrtcReconnectTimer: function() {
        this.webrtcReconnectTimer && window.clearTimeout(this.webrtcReconnectTimer);
        this.webrtcReconnectTimer = null;
    },

    initSipConnectionTimer: function() {
        var self = this;
        if (!self.sipConnectionTimer) {
            self.sipConnectionTimer = window.setTimeout(function() {
                //if SIP end point is disconnected end the meeting
                if(self.error)
                    self.error('sipConnectionTimeout');
                self.endMeeting();
            }, self.bjnSIPTimeout);
        }
    },

    clearSipConnectionTimer: function() {
        this.sipConnectionTimer && window.clearTimeout(this.sipConnectionTimer);
        this.sipConnectionTimer = null;
    },

    initBJNCloudConnectionTimer: function() {
        var self = this;
        if(!this.bjnCloudConnectiontimer) {
            this.bjnCloudConnectiontimer = window.setTimeout(function(){
                  if(self.onError)
                    self.onError('bjnCloudUnreachable');
                self.endMeeting();
            }, this.bjnCloudTimeout);
        }
    },

    clearBJNCloudConnectionTimer: function() {
        this.bjnCloudConnectiontimer && window.clearTimeout(this.bjnCloudConnectiontimer);
        this.bjnCloudConnectiontimer = null;
    },

    initReconnectTimer : function(){
        if(this.reconnectInterval<32000) {
            this.reconnectInterval *= 2;
        }
        Logger.debug("reconnect interval" + this.reconnectInterval);
        this.WebRTCPairing();
        this.reconnectTimer = window.setTimeout(this.initReconnectTimer, this.reconnectInterval);
    },

    getMicrophoneVolume: function() {
        if(!this.isVolumeMonitorStarted) {
            this.rtcController.startVolumeMonitoring(this.rtcController.model.get('localAudioStream'),params={});
            this.isVolumeMonitorStarted = true;
        }
        return this.rtcController.model.get('volumeLevel');
    },

    createFakeStream: function(stream) {
        var self = this;
        if(_.isNull(this.fakeStream)) {
            navigator.mediaDevices.getUserMedia({video: true, audio: false, fake : true})
            .then(function(stream){
                stream.getVideoTracks().forEach(function(track) {
                    if(track)
                        track.stop();
                });
            Logger.debug('RTCManager: Adding fake stream for firefox');
    stream.bjn_label = "fake_stream";
            self.fakeStream = stream;
            });
        }
    },

    clearReconnectTimer : function(){
        this.reconnectTimer && window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.reconnectInterval = 1000;
    },

    endMeeting : function() {
        Logger.debug("End the meeting");
        self.fakeStream = null;
        this.rtcController.stopVolumeMonitoring();
        this.isVolumeMonitorStarted = false;
        this.rtcController.endCall();
        this.disconntEventService();
    }
});

module.exports = RTCManager;
