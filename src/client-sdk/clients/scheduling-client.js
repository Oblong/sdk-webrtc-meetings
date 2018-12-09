
/**
 * Created by nitesh on 16/09/16.
 */

var RestClient = require('./rest-client');

var setParams = function (s) {
    var currentTime = new Date();
    var start =  currentTime.getTime();
    var end =  currentTime;
    end.setHours(end.getHours()+1);
    end = end.getTime();

    var schedulingParams = {
        "description": "",
        "addAttendeePasscode": false,
        "endPointVersion": "1.80",
        "timezone": "US/Mountain",
        "end": "",
        "title": "Test Meeting",
        "advancedMeetingOptions": {
            "allowStream": false,
            "autoRecord": false,
            "muteParticipantsOnEntry": false,
            "encryptionType": "ENCRYPTED_ONLY",
            "makeDefault": false,
            "moderatorLess": true,
            "videoBestFit": false,
            "disallowChat": false,
            "publishMeeting": false,
            "showAllAttendeesInMeetingInvite": false
        },
        "isLargeMeeting": false,
        "endPointType": "WEB_APP",
        "start": "",
        "recurrencePattern": {
            "recurrenceCount": 0,
            "daysOfWeekMask": 0,
            "frequency": 0,
            "recurrenceType": "NONE",
            "weekOfMonth": "NONE",
            "monthOfYear": "NONE",
            "endDate": null,
            "dayOfMonth": 0
        }
    };
    schedulingParams.start = start;
    schedulingParams.end   = end;
    return schedulingParams;
};

var scheduleMeeting = function (user, cb) {
    var requestUrl = "/seamapi/v1/user/"+ user.leaderId + "/scheduled_meeting/" + "?access_token="
        + encodeURIComponent(user.userToken);

    var params = {
        url: requestUrl,
        body: setParams()
    };
    RestClient.post(params, cb);
};

module.exports = {
  scheduleMeeting: scheduleMeeting
};
