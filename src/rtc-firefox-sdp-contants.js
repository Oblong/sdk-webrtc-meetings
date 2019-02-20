var my              = require('myclass');
var BrowserDetector = require('browserDetector');


var RTCFirefoxSDPConstants = my.Class({

  constructor: function() {
    this.FIREFOX_SDP_OBJ = {
      SDP_MID_0: 'sdparta_0',
      SDP_MID_1: 'sdparta_1',
      SDP_MID_2: 'sdparta_2'
    };
    if(BrowserDetector.browser === "firefox" && BrowserDetector.majorVersion >= 63) {
      this.FIREFOX_SDP_OBJ = {
        SDP_MID_0: '0',
        SDP_MID_1: '1',
        SDP_MID_2: '2'
      };
    }
  }

});

module.exports = new RTCFirefoxSDPConstants();
