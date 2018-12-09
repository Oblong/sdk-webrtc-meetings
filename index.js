const RTCManager = require('./src/rtc-manager');
const RTCClient = require('./src/rtc-client');
const RTCRoster = require('./src/rtc-roster');
const defaultRTCParams = {
  peerConfig: {
    receiveMedia: {
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    },
    peerConnectionConfig: {
      iceServers: [],
      forceTurn: false
    },
    peerConnectionConstraints: {
      optional: [
        {DtlsSrtpKeyAgreement: true}
      ]
    }
  }
};

module.exports = {
  defaultRTCParams,
  RTCClient,
  RTCManager,
  RTCRoster
};
