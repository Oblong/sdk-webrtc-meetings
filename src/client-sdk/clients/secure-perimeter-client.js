/**
 * Created by nitesh on 16/09/16.
 */
var RestClient = require('./rest-client');

var aggregatePairing = function (meeting, cb) {
    var requestUrl = "/seamapi/v1/services/pairingCodeGenerator?stringifyOauthJson=false" +
        "&includeProfilePictureUrl=false&includePhoneContactInfo=false&includePairing=false";
    var requestBody = meeting;
    var aggregatePairingParams = {
        url: requestUrl,
        body: requestBody
    };

    RestClient.post(aggregatePairingParams, cb);
};

var webRTCPairing = function (meeting, cb) {
    var requestUrl = "/seamapi/v1/user/" + meeting.oauthInfo.scope.meeting.leaderId + "/live_meetings/"
        + meeting.oauthInfo.scope.meeting.meetingNumericId + "/pairing_code/webrtc?access_token="
        + encodeURIComponent(meeting.oauthInfo.access_token);
    var requestBody = {
        endpointType: 4,
        userId: meeting.oauthInfo.scope.meeting.leaderId,
        languageCode: "en",
        capabilities: ["AUDIO","VIDEO","CONTENT"]
    };
    var params = {
        url: requestUrl,
        body: requestBody
    };

    RestClient.post(params, cb);
};

var sipDialout = function (meeting, sipUrl, cb) {
    var requestUrl = "/seamapi/v1/user/" + meeting.oauthInfo.scope.meeting.leaderId + "/live_meetings/"
        + meeting.oauthInfo.scope.meeting.meetingNumericId + "/dialout/pstn?access_token="
        + encodeURIComponent(meeting.oauthInfo.access_token);
    var requestBody = {
        "uri": sipUrl
    };
    var params = {
        url: requestUrl,
        body: requestBody
    };

    RestClient.post(params, cb);
};

module.exports = {
    aggregatePairing: aggregatePairing,
    webRTCPairing: webRTCPairing,
    sipDialout: sipDialout
};
