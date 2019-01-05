/*
* Blue Jeans WebRTC Local Media Manager
* =====================================================================================
* @version In bower.json
*
*/

var my   				= require('myclass');
var _       			= require('underscore');
var Logger				= require('Logger');
var Backbone 			= require('backbone');
var Q 					= require('q');
var RTCUtils 			= require('./rtc-utils');

  var RTCErrors           = require('./rtc-error');
  var RTCBlueJay          = require('./rtc-bluejay');

  var RTCSignallingManager    = require('./rtc-signalling-manager');
  var RTCTransactionManager   = require('./rtc-transaction-manager');

  var LocalMedia          = require('localmedia');
  var attachMediaStream   = require('attachmediastream');
  var Hark                = require('hark');
  var BrowserDetector     = require('browserDetector');

  var LocalMediaModel = Backbone.Model.extend({

      defaults: {
          previewStream: null,
          localStream: null,
          localAudioStream: null,
        localVideoStream: null,
        remoteStream: null,
          localAudioMuted: false,
          localVideoMuted: false,
          remoteAudioMuted: false,
          remoteVideoMuted: false,
          localStreamStopped: false,
          availableDevices: {audioIn: [], videoIn: [], audioOut: []},
          selectedMic: null,
          selectedCamera: null,
          selectedSpeaker: null,
          volumeLevel: 0,
          isSpeaking: false
      }
  });

var RTCLocalMediaManager = my.Class({

  chromeConfig: {
    mediaConstraints: {
      audio:{
        advanced:[
                      {googEchoCancellation:true},
                      {googAutoGainControl:true},
                      {googNoiseSuppression:true},
                      {googHighpassFilter:true},
                      {googAudioMirroring:false},
                      {googNoiseSuppression2:true},
                      {googEchoCancellation2:true},
                      {googAutoGainControl2:true},
                      {googDucking:false}
                  ]
              },
      video: {
                  width  : { min : 1280, max : 1280 },
        height : { min : 720, max : 720 }
              }
    },
    selfViewConfig: {
      autoplay: true, mirror: true, muted: true
    },
          volumeMonitoring: {
              interval  : 300, // polling time (in ms) used for detecting speech/volume change
              threshold : -50  // Decibel level threshold used to determine speech signals in local audio stream
          }
  },

      firefoxConfig: {
          mediaConstraints: {
              audio: {
                  advanced : [
                      {"echoCancellation"    : true},
                      {"mozAutoGainControl"  : true},
                      {"mozNoiseSuppression" : true}
                  ]
              },
              video: {
                  "width"     : {"min" : "640", "ideal": "1280"},
                  "height"    : {"min" : "360", "ideal": "720"}
              }
          },

          selfViewConfig: {
              autoplay: true, mirror: true, muted: true
          },

          volumeMonitoring: {
              interval  : 300, // polling time (in ms) used for detecting speech/volume change
              threshold : -50  // Decibel level threshold used to determine speech signals in local audio stream
          }
      },

  volumeMonitor: null,
      isSignallingChannelReady : false,
      vadCount: 0,

  constructor : function(options) {
    _.bindAll(this);
          _.extend(this, Backbone.Events);
    // override default config with passed in options
          this.config = (BrowserDetector.browser === 'firefox') ? this.firefoxConfig : this.chromeConfig;
          this.config = RTCUtils.deepMergeObjects(this.config, options);
      this.model                      = new LocalMediaModel();
      this.localMedia                 = new LocalMedia(this.config);
          this.cachedMediaConstraints     = this.config.mediaConstraints;
          RTCTransactionManager.on('receivedConnectResponse', this.onReceiveConnectResponse);
  },

  startMedia: function(constraints, streamType) {
          var self = this;
    var deferred = Q.defer();
          var mediaConstraints = RTCUtils.deepMergeObjects(this.cachedMediaConstraints, constraints);
          var prevConstraints = this.cachedMediaConstraints;

          this._startMedia(mediaConstraints, streamType).then(function(streamList){
              deferred.resolve(streamList);
              self.detectDeviceChange(prevConstraints,mediaConstraints);
          },
          function(error){
              deferred.reject(error);
          });

          this.cachedMediaConstraints = mediaConstraints;
    return deferred.promise;
  },

      _startMedia: function(constraints, streamType){
    var deferred = Q.defer();
    var self = this;
          var micPreferenceChanged = this.hasMicPreferenceChanged(this.cachedMediaConstraints, constraints);
          var cameraPreferenceChanged = this.hasCameraPreferenceChanged(this.cachedMediaConstraints, constraints);

          var streamList = [];
          var skip = false;

          //Use the local_stream for preview_stream is the camera and mic prefrence have not changed
          if(BrowserDetector.browser === 'firefox' && streamType === 'preview_stream'
              && !micPreferenceChanged && !cameraPreferenceChanged) {
              var localStream = this.model.get('localStream');
              this.stopPreviewStream();
              if(!_.isUndefined(localStream) && !_.isNull(localStream)) {
                  var previewStream = localStream.clone();
                  previewStream.bjn_label = 'preview_stream';
                  previewStream.getTracks().forEach(function(track){
                      track.enabled = true;
                  });
                  this.model.set('previewStream', previewStream);
                  streamList.push(previewStream)
                  deferred.resolve(streamList);
                  skip = true;
              }
          }

          if(!skip) {
              //Remove all streams before requesting the new streams
              if(BrowserDetector.browser === 'firefox') {
                  this.stopLocalStreams();
                  this.stopPreviewStream();
                  this.stopVolumeMonitor();
                  this.stopLocalStreamClone();
              }

              if(BrowserDetector.browser === 'firefox' &&
                  (constraints.audio === false && constraints.video === false))
              {
                  //FF fails the call if both A/V device are not present. To avoid it create
                  //fake streams for both audio and video and to continue with the call
                  streamList = self.startMediaSuccess({ stream: null, type: streamType, micChanged: false, cameraChanged: false});
                  deferred.reject(RTCErrors.GET_LOCAL_MEDIA_STATES.DevicesNotFoundError);
              } else {
                  this.localMedia.start(constraints, function(error, stream) {
                  if(error) {
                      var gumError = RTCErrors.translateGetUserMediaError(error);
                      Logger.error('RTCLocalMediaManager: Error in get user media: ', JSON.stringify(gumError));
                      deferred.reject(gumError);
                  }
        else{
                      self.startMediaSuccess({ stream: stream, type: streamType, micChanged: micPreferenceChanged,
                          cameraChanged: cameraPreferenceChanged}).then(function(streamList) {
                              deferred.resolve(streamList);
                          });
                      }
                  });
              }
          }
    return deferred.promise;
      },

      startMediaSuccess: function(params){
          var previewStream       = null;
          var localStream         = params.stream;
          var localStreamClone    = null;
          var localVideoMuted     = this.model.get('localVideoMuted');
          var streamList          = [];
          var self = this;
    var deferred = Q.defer();

          if(BrowserDetector.browser === 'firefox' && localStream)
              this.saveLocalStream(localStream);

          if(params.type === 'local_stream') {
        this.createLocalStreams(localStream).then(function(localStreamList){
                  deferred.resolve(localStreamList);
              });
              return deferred.promise;
          } else {
              this.stopPreviewStream();
              previewStream = localStream;
              previewStream.bjn_label = 'preview_stream';
              previewStream.onended = function() {
                  Logger.warn('RTCLocalMediaManager: Preview stream has ended. Id: ', this.id);
              };
              streamList.push(previewStream);

              if(params.micChanged || (!localVideoMuted && params.cameraChanged)
                  || (params.cameraChanged && BrowserDetector.browser === 'firefox')) {

                  this.stopLocalStreams();

                  localStreamClone = localStream.clone();
                  this.model.set('previewStream', previewStream);
                  this.createLocalStreams(localStreamClone).then(function(localStreamList){
                      streamList = streamList.concat(localStreamList);
                      self.trigger('localStreamsChanged');
          deferred.resolve(streamList);
                  });
        return deferred.promise;
              } else {
                  this.model.set('previewStream', previewStream);
                deferred.resolve(streamList);
                  return deferred.promise;
      }
          }
      },

      createLocalStreams: function(localStream) {
          var deferred = Q.defer();
          var localStreamClone    = null;
          var streamList          = [];
          var self = this;
          var promises = [];
          if(this.hasVideoTracks(localStream) && this.hasAudioTracks(localStream))
              localStreamClone = localStream.clone();
          else
              localStreamClone = localStream;

          promises.push(this.extractAudioOnlyStream(localStream).then(function(localAudioStream){
              if(localAudioStream) {
                  streamList.push(localAudioStream);
                  self.model.set('localAudioStream', localAudioStream);
              }
          }, function(error) {
              Logger.error("RTCLocalMediaManager :: error while extracting audio stream", error);
          }));

          promises.push(this.extractVideoOnlyStream(localStreamClone).then(function(localVideoStream){
              if(localVideoStream) {
                  streamList.push(localVideoStream);
                  self.model.set('localVideoStream', localVideoStream);
              }
          }, function(error){
              Logger.error("RTCLocalMediaManager :: error while extracting audio stream", error);
          }));

          Q.all(promises).then(function() {
              deferred.resolve(streamList);
          }, function(err) {
              Logger.error('RTCLocalMediaManager: Failed to create local streams');
              deferred.reject(err);
          });

          return deferred.promise;
      },

      saveLocalStream: function(stream) {
          var oldStream = this.model.get('localStream');
          if(oldStream) {
              this.localMedia.stop(oldStream);
              oldStream = null;
          }
          var newStream = stream.clone();
          newStream.getTracks().forEach(function(track) {
              track.enabled = false;
          });
          newStream.label = 'local_stream';
          this.model.set('localStream', newStream);
      },

      hasMicPreferenceChanged: function(prevConstraints, newConstraints) {
          var prevMicId = this.getSourceId(prevConstraints.audio);
          var newMicId = this.getSourceId(newConstraints.audio);
          return (!_.isNull(newMicId) && (prevMicId !== newMicId)) ? true : false;
      },

      hasCameraPreferenceChanged: function(prevConstraints, newConstraints) {
          var prevCameraId = this.getSourceId(prevConstraints.video);
          var newCameraId = this.getSourceId(newConstraints.video);
          return (!_.isNull(newCameraId) && (prevCameraId !== newCameraId)) ? true : false;
      },

      getSourceId: function(constraints) {
          var sourceId = null;

          if(constraints.deviceId) {
              sourceId = constraints.deviceId;
          }
          return sourceId;
      },

      hasAudioTracks: function(stream) {
          return (stream && (stream.getAudioTracks().length > 0));
      },

      hasVideoTracks: function(stream) {
          return (stream && (stream.getVideoTracks().length > 0));
      },

      extractAudioOnlyStream: function(stream) {
          var deferred = Q.defer();
          var muteAudio = this.model.get('localAudioMuted');
          var self = this;

          var setAudioProperty = function(audioStream) {
              // If local audio is currently been muted, Mute the new audio stream as well.
              if(muteAudio) {
                  audioStream.getAudioTracks().forEach(function (track) {
                      track.enabled = !muteAudio;
                  });
              }

              audioStream.bjn_label = 'local_audio_stream';
              audioStream.getAudioTracks()[0].onended = function() {
                  Logger.warn('RTCLocalMediaManager: Local Audio track has ended. Id: ', this.id);
                  self.model.set('localAudioStream', null);
              };
              return audioStream;
          };

          if (this.hasAudioTracks(stream)){
              var audioStream = stream;
              if(audioStream.getVideoTracks().length > 0) {
                  audioStream.getVideoTracks()[0].stop();
                  audioStream.removeTrack(audioStream.getVideoTracks()[0]);
              }
              audioStream = setAudioProperty(audioStream);
              deferred.resolve(audioStream);
          } else if (BrowserDetector.browser === 'firefox') {
              navigator.mediaDevices.getUserMedia({audio: true, fake : true}).then(function(fakeStream){
                  var audioStream = fakeStream;
                  //Set mute state to true while creating a fake stream
                  muteAudio = true;
                  audioStream = setAudioProperty(audioStream);
                  deferred.resolve(audioStream);
              }, function(error){
                  Logger.debug("RTCLocalMediaManager :: Error creating audio fake stream");
                  deferred.reject(error);
              });
          } else {
              deferred.resolve(null);
          }
          return deferred.promise;
      },

      extractVideoOnlyStream: function(stream) {
          var deferred = Q.defer();
          var muteVideo = this.model.get('localVideoMuted');
          var self = this;

          var setVideoProperty = function(videoStream, isFFFakeStream) {
              if(muteVideo)
              {
                  videoStream.getVideoTracks().forEach(function (track) {
                      if(BrowserDetector.browser === 'firefox' && !isFFFakeStream)
                          track.enabled = !muteVideo;
                      else
                          track.stop();
                  });
              }
              videoStream.bjn_label = 'local_video_stream';
              videoStream.getVideoTracks()[0].onended = function() {
                  Logger.warn('RTCLocalMediaManager: Local Video track has ended. Id: ', this.id);
                  self.model.set('localVideoStream', null);
              };
              return videoStream;
          };

          if(this.hasVideoTracks(stream)) {
              var videoStream = stream;
              if(videoStream.getAudioTracks().length > 0) {
                  videoStream.getAudioTracks()[0].stop();
                  videoStream.removeTrack(videoStream.getAudioTracks()[0]);
              }
              videoStream = setVideoProperty(videoStream, false);
              deferred.resolve(videoStream);
          } else if (BrowserDetector.browser === 'firefox') {
              navigator.mediaDevices.getUserMedia({video: true, fake : true}).then(function(fakeStream){
                  var videoStream = fakeStream;
                  //Set mute state to true while creating a fake stream
                  muteVideo = true;
                  videoStream = setVideoProperty(videoStream, true);
                  deferred.resolve(videoStream);
              }, function(error){
                  Logger.debug("RTCLocalMediaManager :: Error creating fake stream");
                  deferred.reject(error);
              });
          } else {
              deferred.resolve(null);
          }
          return deferred.promise;
      },

      stopLocalStreams: function() {
          this.stopLocalAudioStream();
          this.stopLocalVideoStream();
      },

      stopLocalAudioStream: function() {
          this.stopMedia(this.model.get('localAudioStream'), 'localAudioStream');
      },

      stopLocalVideoStream: function() {
          this.stopMedia(this.model.get('localVideoStream'), 'localVideoStream');
      },

      stopPreviewStream: function() {
          this.stopMedia(this.model.get('previewStream'), 'previewStream');
      },

      stopLocalStreamClone: function() {
          this.stopMedia(this.model.get('localStream'), 'localStream');
      },

  stopMedia: function(stream, streamType) {
    if(!_.isNull(stream) && !_.isUndefined(stream)) {
              //var streamType = RTCUtils.getLocalStreamType(stream);
              this.localMedia.stop(stream);
              Logger.debug("RTCLocalMediaManager: " + streamType + " has been stopped.")
              this.model.set(streamType, null, {silent: true});
          }
  },

      renderStream: function(params) {
          params.config = _.defaults({autoplay: true, mirror: false, muted: false}, params.config);
          return this.attachMediaStream(params);
      },

      renderSelfView: function(params) {
          params.config = _.defaults(this.config.selfViewConfig, params.config);
          return this.attachMediaStream(params);
      },

  attachMediaStream: function(params) {
    if(!params.stream || !params.el) {
      Logger.error('RTCLocalMediaManager: Incorrect params passed to attachmediastream API. stream: ' + params.stream + ', el: ' + params.el);
      return null;
    }

    params.el && (params.el.oncontextmenu = function () { return false; });
    return attachMediaStream(params.stream, params.el, params.config);
  },

      getDevices: function() {
          var self = this;
          var deferred = Q.defer();
          var newDevices = {audioIn: [], videoIn: [], audioOut: []};
          var selectedAudioDevice = "";
          var selectedVideoDevice = "";
          var selected = {audioIn : null, videoIn : null};

          //get selected devices,if available
          if(this.model.get('localAudioStream')){
              selectedAudioDevice = this.model.get('localAudioStream').getAudioTracks()[0].label;
          }

          if(this.model.get('localVideoStream')){
              selectedVideoDevice = this.model.get('localVideoStream').getVideoTracks()[0].label;
          }

          var _getDevicesSuccess = function(devices) {
              var newDevices = {audioIn: [], videoIn: [], audioOut: []};

              _.each(devices, function(device, i, list) {
                  if(device.kind === 'audio' || device.kind === 'audioinput') {
                      newDevices.audioIn.push(self.translateDeviceInfo(device));
                      if(device.label === selectedAudioDevice)
                          selected.audioIn = device;
                  } else if(device.kind === 'video' || device.kind === 'videoinput') {
                      newDevices.videoIn.push(self.translateDeviceInfo(device));
                      if(device.label === selectedVideoDevice)
                          selected.videoIn = device;
                  } else if(device.kind === 'audiooutput') {
                      newDevices.audioOut.push(self.translateDeviceInfo(device));
                  }
              });
              self.model.set('availableDevices', newDevices);
              deferred.resolve({available : newDevices, selected: selected});
          };

          var _getDevicesFailed = function(error) {
              deferred.reject("Error in navigator.mediaDevices.enumerateDevices API");
          };

          if(navigator.mediaDevices.enumerateDevices) {
              navigator.mediaDevices.enumerateDevices().then(_getDevicesSuccess).catch(_getDevicesFailed);
          } else if(MediaStreamTrack.getSources) {
              MediaStreamTrack.getSources(_getDevicesSuccess);
          } else {
              deferred.reject("Browser doesn't support MediaStreamTrack.getSources API");
          }

          return deferred.promise;
      },

      translateDeviceInfo: function(device) {
          var deviceId = device.id || device.deviceId;
          if(device.kind === 'audiooutput') {
              deviceId = this.transformSpeakerId(deviceId, true);
          }
          return {
              id      : deviceId,
              label   : device.label,
              kind    : device.kind,
              facing  : device.facing,
              groupId : device.groupId
          }
      },

      transformSpeakerId: function(deviceId, forwardTransform) {
          var speakerSuffix = "_speaker";
          if(forwardTransform) {
              return deviceId + speakerSuffix;
          } else {
              if(deviceId && deviceId.indexOf(speakerSuffix) !== -1) {
                  deviceId = deviceId.split(speakerSuffix)[0];
              }
              return deviceId;
          }
      },

      updateStream: function(params) {
          if(!_.isUndefined(params.remoteStream)) {
              this.model.set('remoteStream', params.remoteStream);
          }
      },

  /* ============================= */
  /*        Mute Controls  		 */
  /* ============================= */

  muteStreams: function(muteParams) {
          var mutePromise = Q.defer();
          var promises = [];

    if(!_.isUndefined(muteParams.localAudio)) {
              promises.push(this.muteLocalAudio(muteParams.localAudio));
          }
    if(!_.isUndefined(muteParams.localVideo)) {
              promises.push(this.muteLocalVideo(muteParams.localVideo));
          }
    if(!_.isUndefined(muteParams.remoteAudio)) {
              promises.push(this.muteRemoteAudio(muteParams.remoteAudio));
          }
    if(!_.isUndefined(muteParams.remoteVideo)) {
              promises.push(this.muteRemoteVideo(muteParams.remoteVideo));
          }

          Q.all(promises).then(function() {
              mutePromise.resolve();
          }, function() {
              Logger.error('RTCLocalMediaManager: Failed to mute local/remote stream');
          })

          return mutePromise.promise;
  },

  muteLocalAudio: function(mute) {
          var deferred = Q.defer();

          var stream = this.model.get('localAudioStream');
    var currentMuteState = this.isAudioMuted(stream);
    var muteToggled = _.isBoolean(mute) && (currentMuteState !== mute);

          if(!muteToggled) {
              Logger.debug('Local Audio is already ' + (currentMuteState ? "muted." : "unmuted.") + " Ignoring the mute request.");
              deferred.resolve();
              return deferred.promise;
          }
          if(!_.isNull(stream) && !_.isUndefined(stream)) {

              Logger.debug('RTCLocalMediaManager: ' + (mute ? 'Muting ' : 'Unmuting ') + 'local audio stream now');

              stream.getAudioTracks().forEach(function (track) {
              track.enabled = !mute;
              });

              this.model.set('localAudioMuted', mute);
              Logger.debug('RTCLocalMediaManager: Local Audio ', (mute ? 'muted' : 'unmuted'));

          } else {
              Logger.warn('Local Audio stream is null, cannot mute/unmute local audio');
          }

          deferred.resolve();
          return deferred.promise;
  },

  muteLocalVideo: function(mute) {
          var deferred = Q.defer();

          var currentMuteState = this.model.get('localVideoMuted');
          var muteToggled = _.isBoolean(mute) && (currentMuteState !== mute);

          if(!muteToggled) {
              Logger.debug('Local Video is already ' + (currentMuteState ? "muted." : "unmuted.") + " Ignoring the mute request.");
              deferred.resolve();
              return deferred.promise;
          }
          mute ? this._stopLocalVideo(deferred) : this._resumeLocalVideo(deferred);

          return deferred.promise;
  },

      _stopLocalVideo: function(deferred) {
          var stream  = null;
          var self    = this;

          stream = this.model.get('localVideoStream');
          if(!_.isNull(stream) && !_.isUndefined(stream)) {
              Logger.debug('RTCLocalMediaManager: Stopping/Muting local video stream now');
              stream.getVideoTracks().forEach(function (track) {
                  if (BrowserDetector.browser === 'firefox')
                      track.enabled = false;
                  else
                      track.stop();
              });
              Logger.debug('RTCLocalMediaManager: Local Video muted');
          } else {
              Logger.warn('Local Video stream is null, cannot mute/unmute local video');
          }
          this.model.set('localVideoMuted', true);
          this.model.set('localVideoStream', null);
          deferred.resolve();
      },

      _resumeLocalVideo: function(deferred) {
          var self    = this;
          var mediaConstraints = RTCUtils.deepMergeObjects(this.cachedMediaConstraints, {audio: false});

          this.model.set('localVideoMuted', false);
          if (BrowserDetector.browser === 'firefox'){
              var stream = this.model.get('localVideoStream');
              if(!_.isNull(stream) && !_.isUndefined(stream)) {
                  stream.getVideoTracks().forEach(function (track) {
                      track.enabled = true;
                  });
              }
              deferred.resolve();
          } else {
              this._startMedia(mediaConstraints, 'local_stream').then(function(streams){
                  Logger.debug('RTCLocalMediaManager: Local Video unmuted');
                  deferred.resolve();
              },
              function(error){
                  Logger.warn('RTCLocalMediaManager: Failed to get local video stream: ' + error);
                  deferred.resolve();
              });
          }
      },

  muteRemoteAudio: function(mute) {
          var deferred = Q.defer();
    var stream = this.model.get('remoteStream');

          if(!_.isNull(stream) && !_.isUndefined(stream)) {
      stream.getAudioTracks().forEach(function (track) {
              track.enabled = !mute;
          });
          this.model.set('remoteAudioMuted', mute);
    } else {
      Logger.warn('Remote stream is null, cannot mute/unmute remote audio');
    }

          deferred.resolve();
          return deferred.promise;
  },

  muteRemoteVideo: function(mute) {
          var deferred = Q.defer();
    var stream = this.model.get('remoteStream');

          if(!_.isNull(stream) && !_.isUndefined(stream)) {
      stream.getVideoTracks().forEach(function (track) {
              track.enabled = !mute;
          });
          this.model.set('remoteVideoMuted', mute);
    } else {
      Logger.warn('Remote stream is null, cannot mute/unmute remote video');
    }

          deferred.resolve();
          return deferred.promise;
  },

      isAudioMuted: function(stream) {
          var isMuted = true;
          if(!_.isNull(stream) && !_.isUndefined(stream)) {
              stream.getAudioTracks().forEach(function (track) {
                  isMuted = isMuted && !track.enabled;
              });
          }
          return isMuted;
      },

  /* ============================= */
  /*    Volume/Speech Monitoring   */
  /* ============================= */

  startVolumeMonitor: function(stream, options) {
          _.extend(this.config.volumeMonitoring, options);
    var monitoredStream = stream.clone();
    monitoredStream.getAudioTracks().forEach(function(track){
      track.enabled = true;
    });
    monitoredStream.getVideoTracks().forEach(function(track){
      track.stop();
    });
    this.volumeMonitor = Hark(monitoredStream, options);
    this.volumeMonitor.monitoredStream = monitoredStream;
    this.volumeMonitor.on('volume_change', this.volumeLevelChanged);
    Logger.debug("RTCLocalMediaManager: Started volume monitor");
  },

  volumeLevelChanged: function(volume, speechThreshold) {
    // Normalize volume to be between [0, 10] - values received are between -30 to -100 decibels
    var avgVolume = Math.abs(1 - Math.abs(volume / 100));
    if(typeof avgVolume === 'number') {
      avgVolume = parseFloat(avgVolume.toFixed(3));
    }
    var normalizedVolume = (avgVolume < 1) ? avgVolume : 0;
    this.model.set('volumeLevel', normalizedVolume);
          this.checkIfSpeaking(volume);
  },

      checkIfSpeaking: function (vol){
          var spFrameMs  = 20;  //frame size in ms. for now it's dsp frame size. Can be much bigger for non-real time app
          var vadOnThreshold  = (140/spFrameMs); // # of speech frames to turn on VAD
          var vadHangOverThreshold = (260/spFrameMs); // # of speech frames to turn off VAD after it's on

          if(vol >= this.config.volumeMonitoring.threshold){
              this.vadCount++;
              if(this.vadCount >= vadOnThreshold){
                  //secure the vad after solid vadOnThrd counts of above threshold
                  this.vadCount = vadHangOverThreshold + vadOnThreshold;
              }
          }
          else{
              this.vadCount--;
              if(this.vadCount < vadOnThreshold) {
                  this.vadCount = 0; //reset it to exclude noises
              }
          }

          this.model.set('isSpeaking', (this.vadCount >= vadOnThreshold) ? true : false);
          //Logger.debug("volume: " + vol + ", vadCount: "+ this.vadCount);
      },

  stopVolumeMonitor: function() {
    if(!_.isNull(this.volumeMonitor)) {
      Logger.debug("RTCLocalMediaManager: Stopping volume monitor");
      if(this.volumeMonitor.monitoredStream) {
        this.volumeMonitor.monitoredStream.getTracks().forEach(function (track) { track.stop(); });
        this.volumeMonitor.monitoredStream = null;
      }
      this.volumeMonitor.stop();
    }
  },

      setSpeaker: function(params) {
          var self = this;
          var mediaElements = params.mediaElements;
          var speakerDeviceId = params.speakerId;

          _.each(mediaElements, function (element) {
              if(element && typeof element.setSinkId === 'function' && speakerDeviceId) {
                  element.setSinkId(self.transformSpeakerId(speakerDeviceId, false));
              }
          });

          if(speakerDeviceId && speakerDeviceId !== this.model.get('selectedSpeaker')) {
              this.model.set('selectedSpeaker', speakerDeviceId);
              this.sendDeviceInfo();
          }
      },

      detectCameraStatus: function(streamType) {
          var videoTrack, self = this;

    var deferred = Q.defer();

          var stream = (streamType === 'local_stream') ? this.model.get('localVideoStream') : this.model.get('previewStream');

          if(stream && typeof(stream.getVideoTracks) === 'function') {
              videoTrack = stream.getVideoTracks()[0];

              if(videoTrack) {
                  window.setTimeout(function() {
                      var videoMuteState = (streamType === 'local_stream') ? self.model.get('localVideoMuted') : false;

                      if((videoTrack.readyState === 'ended') && !videoMuteState) {
                          Logger.warn('RTCLocalMediaManager: Camera feed is unavailable, faulty camera or its in use by another program');
                          deferred.resolve(RTCErrors.GET_LOCAL_MEDIA_STATES.SOURCE_UNAVAILABLE);
                      }
                      else {
                          deferred.resolve(RTCErrors.GET_LOCAL_MEDIA_STATES.AVAILABLE);
                      }
                  }, 500);
              } else {
                  Logger.warn("RTCLocalMediaManager: Stream doesn't have any video tracks");
                  deferred.resolve(RTCErrors.GET_LOCAL_MEDIA_STATES.SOURCE_UNAVAILABLE);
              }
          } else {
              deferred.resolve(RTCErrors.GET_LOCAL_MEDIA_STATES.DEVICES_NOT_FOUND);
          }
          return deferred.promise;
      },

      detectDeviceChange: function(previousConstraints, newConstraints) {

          var micPreferenceChanged = this.hasMicPreferenceChanged(previousConstraints, newConstraints);
          var cameraPreferenceChanged = this.hasCameraPreferenceChanged(previousConstraints, newConstraints);

          this.model.set('selectedCamera', this.getSourceId(newConstraints.video));
          this.model.set('selectedMic', this.getSourceId(newConstraints.audio));

          if (micPreferenceChanged || cameraPreferenceChanged) {
              this.sendDeviceInfo();
          }
      },

      sendDeviceInfo: function() {
          if (!this.isSignallingChannelReady)
              return;

          var micId = this.model.get('selectedMic');
          var cameraId = this.model.get('selectedCamera');
          var speakerId = this.model.get('selectedSpeaker');

          var micLabel = this.getDeviceLabel(micId, 'audioIn');
          var cameraLabel = this.getDeviceLabel(cameraId, 'videoIn');
          var speakerLabel = this.getDeviceLabel(speakerId, 'audioOut');

          Logger.debug('RTCLocalMediaManager: Devices in use, ' + 'Mic - ' + micLabel + ', Camera - ' + cameraLabel + ', Speaker - ' + speakerLabel);

          var deviceInfoMessage = RTCBlueJay.getInfoMsg({
              "type" : "deviceinfo",
              "device" : {
                  "input" : {
                      "audio" : micLabel,
                      "video" : cameraLabel
                  },
                  "output" : {
                      "audio" : speakerLabel,
                      "video" : "Default"
                  }
              }
          });
          RTCSignallingManager.sendMsg(deviceInfoMessage);
          RTCTransactionManager.onBlueJayRequest(deviceInfoMessage);
      },

      getDeviceLabel: function(deviceId, deviceType) {
          var deviceLabel = null;
          var availableDevices = this.model.get('availableDevices');
          _.each(availableDevices[deviceType], function(device, i, list) {
              if (device.id === deviceId) {
                  deviceLabel = device.label;
              }
          });
          return deviceLabel;
      },

      onReceiveConnectResponse: function() {
          this.isSignallingChannelReady = true;
      },

  close: function() {
          this.stopMediaCapture();
          this.isSignallingChannelReady = false;
    this.model.clear().set(LocalMediaModel.defaults);
  },

      stopMediaCapture: function() {
            this.stopLocalStreams();
            this.stopPreviewStream();
            this.stopLocalStreamClone();
            this.cachedMediaConstraints.audio.deviceId = null;
            this.cachedMediaConstraints.video.deviceId = null;
        }
});

module.exports = RTCLocalMediaManager;
