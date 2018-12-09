
var Backbone            = require('backbone');
var RTCUtils            = require('./rtc-utils');

var PeerModel = Backbone.Model.extend({

    initialize: function() {

    },

    setStreamByType: function(stream, type, newValue) {
        var streamType = (type === 'local') ? RTCUtils.getLocalStreamType(stream) : RTCUtils.getRemoteStreamType(stream);
        this.set(streamType, newValue);
    }

}, {
    getDefaults: function() {
        return {
            id                      : null,
            receiveMedia: {
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            },
            peerConnectionConfig: {
                iceServers: [],
                bundlePolicy: "max-bundle",
                rtcpMuxPolicy: "require",
                iceTransports: "all"
            },
            peerConnectionConstraints: {
                optional: []
            },
            iceGatheringState       : '',
            iceConnectionState      : '',
            useTrickleICE           : false,
            localSdp                : null,
            remoteSdp               : null,
            localVideoStream        : null,
            localAudioStream        : null,
            localContentStream      : null,
            remoteStream            : null,
            remoteContentStream     : null,
            closed                  : false,
            signalingState          : ''
        }
    }
});

module.exports = PeerModel;
