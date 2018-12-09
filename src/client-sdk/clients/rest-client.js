
/**
 * Created by Nitesh on 7/8/16.
 */
"use strict"

var options = require('../../config');
var REQUEST_TIMEOUT = 15 * 1000; // secs

var sipDialout = function(params, cb) {
    var postData = JSON.stringify({
        "uri": params.sipUrl
    });

    var xhr = new XMLHttpRequest();
    if (!xhr) {
        console.log("sipDialout: XMLHttpRequest is not supported");
        cb('sipDialout: XMLHttpRequest is not supported');
    }
    xhr.timeout = REQUEST_TIMEOUT; // time in milliseconds

    xhr.addEventListener("readystatechange", function () {
        if (this.readyState === 4) {
            if (this.status === 200) {
                console.log("MeetingApis: sipDialout Response = " + this.responseText);
                cb(null, this.responseText);
            } else {
                var status = this.status || 408;
                console.error("MeetingApis: sipDialout Response error ", status);
                cb(status);
            }
        }
    });

    xhr.addEventListener("error", function(err) {
        console.error("MeetingApis: sipDialout Response error ", this.err);
        cb(this.err);
    });
    xhr.addEventListener("abort", function(err) {
        console.error("MeetingApis: sipDialout Response aborted ", this.err);
        cb(this.err);
    })
    xhr.ontimeout = function (e) {
        console.log("MeetingApis: sipDialout XMLHttpRequest timeout");
        cb("XMLHttpRequest timeout");
    };
    console.log("MeetingApis: sipDialout  Request Body = " + postData);

    var postRequestUrl = options.environment.hostname +
        "/seamapi/v1/user/" + params.oauthInfo.scope.meeting.leaderId + "/live_meetings/"
        + params.oauthInfo.scope.meeting.meetingNumericId + "/dialout/pstn?access_token="
        + encodeURIComponent(params.oauthInfo.access_token);
    console.log("postRequestUrl = ", postRequestUrl);

    xhr.open("POST", postRequestUrl, true);
    xhr.setRequestHeader('X-Foo','header to trigger preflight');
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(postData);
};

var post = function(params, cb) {
    var requestUrl  = options.environment.hostname + params.url;
    var requestData = JSON.stringify(params.body);
    console.log("POST: Request Url = " + requestUrl);
    console.log("POST: Request Body = ", requestData);

    var xhr = new XMLHttpRequest();
    if (!xhr) {
        console.log("POST: XMLHttpRequest is not supported");
        cb("POST: XMLHttpRequest is not supported");
    }

    xhr.timeout = REQUEST_TIMEOUT; // time in milliseconds

    xhr.addEventListener("readystatechange", function () {
        if (this.readyState === 4) {
            if (this.status === 200 || this.status === 201) {
                console.log("POST: Response success = " + this.responseText);
                cb(null, this.responseText);
            } else {
                var status = this.status || 408;
                console.error("POST: Response error = ", status);
                cb({status: status});
            }
        }
    });

    xhr.addEventListener("error", function(err) {
        console.log("POST: onError = ", err);
        cb(err);
    });
    xhr.addEventListener("abort", function(err) {
        console.log("POST: onAbort = ", err);
        cb(err);
    });
    xhr.ontimeout = function () {
        console.log("POST: onTimeout");
        cb({status: 408, "error": "POST timeout"});
    };

    xhr.open("POST", requestUrl, true);
    xhr.setRequestHeader('X-Foo','header to trigger preflight');
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(requestData);
};

module.exports = {
    sipDialout: sipDialout,
    post: post
}
