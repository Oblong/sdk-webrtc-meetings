var Logger = require('Logger');

module.exports = function (RTCManager) {

  Logger.debug("(webrtcclientsdk.js) client Ref Design loading...");
  var config = {
    muteParams: {
      localAudio: false,
      localVideo: false
    }
  };

  const sdkVersion = {
    major : 1,
    minor : 2,
    build : 0
  };

  /* Original - Chrome only version
    var mediaConstraints =  {
        audio:{
            optional:[],
            mandatory:[]
        },
        video:{
        }
    };
  */

  var mediaConstraints=  {
    audio:{},
    video:{}
  };

  var localVideoEl = null;
  var remoteVideoEl = null;
  var contentVideoEl = null;
  var MediaStarted = false;  // new for ffox

  var localDevices = null;
  var localAudioStream = null;
  var localVideoStream = null;
  var remoteStream = null;
  var contentStream = null;

  // client callbacks
  var cbVideoMute = null;
  var cbRemoteConnectionStateChange = null;
  var cbLocalConnectionStateChange = null;
  var cbOnError = null;
  var cbContentShareStateChange = null;

  /*
      options : {
        localVideoEl  : <dom element for local video>,
        remoteVideoEl : <dom element for remote video>,
        contentVideoEl: <dom element for content share video>
        bandWidth     : <100..4096Kbps netwk b/w>,
        devices       : { A/V devices },
        evtVideoUnmute  : callback(),
        evtRemoteConnectionStateChange : callback(),
        evtLocalConnectionStateChange : callback(),
        evtOnError : callback(),
        evtContentShareStateChange : callback()  // ver 1.1.x
  */
  var initialize = function(options) {
    Logger.debug("bjnrtcsdk initializing");
    localDevices = options.devices;
    localVideoEl = options.localVideoEl;
    remoteVideoEl = options.remoteVideoEl;
    contentVideoEl = options.contentVideoEl;

    cbVideoMute = options.evtVideoUnmute;
    cbRemoteConnectionStateChange = options.evtRemoteConnectionStateChange;
    cbLocalConnectionStateChange = options.evtLocalConnectionStateChange;
    cbOnError = options.evtOnError;

    // ver 1.1.x
    if(options.evtContentShareStateChange){
      cbContentShareStateChange = options.evtContentShareStateChange;
    }

    RTCManager.setBandwidth(options.bandWidth);
    MediaStarted = false;
    startLocalStream();

    // get hooks to RTCManager callbacks
    RTCManager.localVideoStreamChange		= updateSelfView;
    RTCManager.localAudioStreamChange		= updateAudioPath;
    RTCManager.remoteEndPointStateChange    = onRemoteConnectionStateChange;
    RTCManager.localEndPointStateChange     = onLocalConnectionStateChange;
    RTCManager.remoteStreamChange           = onRemoteStreamUpdated;
    RTCManager.error                        = onRTCError;
    RTCManager.contentStreamChange			= onContentStreamUpdated;
  };

  //Get the local A/V stream, this stream will be used to for the webrtc connection
  // stream is an array of stream
  // stream[0] - local audio stream
  // stream[1] - local video stream
  var startLocalStream = function() {

    var streamType = 'local_stream';
    if(MediaStarted)
      streamType = 'preview_stream';

    RTCManager.getLocalMedia(mediaConstraints, streamType).then(function(stream) {
      /* Original - Chrome only version
            RTCManager.getLocalMedia(mediaConstraints, 'local_stream').then(function(stream) {
                BJN.localAudioStream = stream[0];
                BJN.localVideoStream = stream[1];
      */

      //---------- New for Firefox ------------------
      for (var i = 0; i < stream.length; i++) {
        if(stream[i].bjn_label === "local_audio_stream") {
          localAudioStream = stream[i]
        } else if(stream[i].bjn_label === "local_video_stream") {
          localVideoStream = stream[i];
        }
      }

      updateSelfView(localVideoStream);
      //Uncomment the below line, if we want to change device in-meeting
            MediaStarted = true;

      if(cbVideoMute) cbVideoMute();
    }, function(err){
      Logger.debug("getLocalMedia error:\n" + JSON.stringify(err,null,2));
    });
  };

  //Callback for local video stream change, it can be used to render self view when the stream is available
  var updateSelfView = function (localStream) {
    if(localStream) {
      RTCManager.renderSelfView({
                stream: localStream,
                el: localVideoEl
            });
    if(cbVideoMute)
      cbVideoMute(false);
      } else
    Logger.debug("updateSelfView no stream!!!");
  };

  // Callback when audio stream changes.  update GUI if stream is defined
  var updateAudioPath = function (localStream) {
    if(localStream) {
      Logger.debug("Audio Path Change");
    }
  };


  var changeAudioInput = function(who) {
    var dev = localDevices.audioIn[ who ].id;
    Logger.debug("Audio Input is changed: " + dev );
    /*  Original Chrome
      mediaConstraints.audio.optional.push( { sourceId: dev } );
    */
    mediaConstraints.audio.deviceId = dev;
    RTCManager.stopLocalStreams();
    startLocalStream();
  };

  var changeVideoInput = function(who) {
    var dev = localDevices.videoIn[ who ].id;
    Logger.debug("Video Input is changed: " + dev );
    /*  Original Chrome
      mediaConstraints.video.optional.push( { sourceId: dev } );
    */
    mediaConstraints.video.deviceId = dev;
    RTCManager.stopLocalStreams();
    startLocalStream();
  };

  var changeAudioOutput = function(who) {
    var dev = localDevices.audioOut[ who ].id;
    Logger.debug("Audio Output is changed: " + dev );
    /*  Original Chrome
      mediaConstraints.audio.optional.push( { sourceId: dev } );
    */
    // 5/30/2017 - bugfix pass mediaElements value as an array rather than discrete object
    RTCManager.setSpeaker({ speakerId : dev, mediaElements : [remoteVideoEl] });
  };

  var setVideoBandwidth = function(bw){
    Logger.debug("Video BW is changed: " + bw);
    RTCManager.setBandwidth(bw);
  };


        /* ========================= */
        /*      Mute Controls   	 */
        /* ========================= */

  var toggleAudioMute = function(event) {
    var audioMuted = config.muteParams.localAudio ? true : false;
    config.muteParams.localAudio = !audioMuted;
    RTCManager.muteStreams(config.muteParams);
    return !audioMuted;
  };

  var toggleVideoMute = function(event) {
    var videoMuted = config.muteParams.localVideo ? true : false;
    config.muteParams.localVideo = !videoMuted;
    RTCManager.muteStreams(config.muteParams);
    if (videoMuted) {
      // since we're about to unmute video lets restart the stream
      MediaStarted = false;
      startLocalStream();
    }
    return !videoMuted;
  };

  var setVolume = function(){
  }



  var joinMeeting = function(meetingParams) {
    if( (meetingParams.numericMeetingId != "") && (meetingParams.displayName != "")) {
      Logger.debug("*** Joining meeting id: " + meetingParams.numericMeetingId);
      RTCManager.startMeeting(meetingParams);
    }
  };

  // End the meeting
  var leaveMeeting = function(event) {
    RTCManager.endMeeting();
    Logger.debug("Leaving meeting");
  };


  var onRemoteConnectionStateChange = function(state) {
    Logger.debug('Remote Connection state :: ' + state);
    if(cbRemoteConnectionStateChange) cbRemoteConnectionStateChange(state);
  };

  var onLocalConnectionStateChange = function(state) {
    Logger.debug('Local Connection state :: ' +  state);
    if(cbLocalConnectionStateChange) cbLocalConnectionStateChange(state);
  };

  var onRemoteStreamUpdated = function(stream) {
    remoteStream = stream;
    if (stream) {
      Logger.debug('Remote stream updated');
      RTCManager.renderStream({
          stream: remoteStream,
          el: remoteVideoEl
      });
    }
  };

  var onContentStreamUpdated = function(stream){
    contentStream = stream;
    if (stream) {
      Logger.debug('Content stream updated');
      RTCManager.renderStream({
        stream: stream,
        el: contentVideoEl
      });
    }
    if(cbContentShareStateChange)
      cbContentShareStateChange(stream != null);
  };

  //Add code to handle error from BJN SDK
  var onRTCError = function(error) {
    Logger.debug("Error has occured :: " + error);
    leaveMeeting();
    if(cbOnError) cbOnError(error);
  };

  var reportSdkVersion = function(){
    return sdkVersion;
  };

  var getLocalAudioStream = function() {
    return localAudioStream;
  };

  var getLocalVideoStream = function() {
    return localVideoStream;
  };

  var getRemoteStream = function() {
    return remoteStream;
  };

  var getContentStream = function() {
    return contentStream;
  };

  return {
    initialize : initialize,
    toggleVideoMute : toggleVideoMute,
    toggleAudioMute : toggleAudioMute,
    changeAudioInput: changeAudioInput,
    changeAudioOutput: changeAudioOutput,
    changeVideoInput : changeVideoInput,
    setVideoBandwidth: setVideoBandwidth,
    joinMeeting : joinMeeting,
    leaveMeeting : leaveMeeting,
    version : reportSdkVersion,
    getLocalAudioStream: getLocalAudioStream,
    getLocalVideoStream: getLocalVideoStream,
    getRemoteStream: getRemoteStream,
    getContentStream: getContentStream
  };
}
