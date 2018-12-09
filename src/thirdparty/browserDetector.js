  /**
   * Usage
   *     var browserDetector = require('Utilities/browserDetector');
   *
   *     browserDetector.os
   *         => one of ['mac', 'windows', 'solaris', 'linux', 'bsd']
   *
   *    browserDetector.osVersion
   *        => something like '10.7' or '6.1'
   *
   *     browserDetector.browser
   *         => one of ['firefox', 'chrome', 'safari', 'opera', 'ie']
   *
   *     browserDetector.version
   *         => something like '9.0.2a'
   *
   *     browserDetector.majorVersion
   *         => something like 9
   *
   *    browserDetector.instructionSet
   *         => one of ['x86', 'x86-64']
   *
   *    browserDetector.device
   *        => one of ['workstation', 'android', 'iphone', 'ipad', 'ipod']
   *
   *    browserDetector.cookies
   *        => one of [true, false]
   */
  var BrowserDetector = function(userAgent){
      userAgent = userAgent || window.navigator.userAgent;

      this.browser = null;
      this.os = null;
      this.osVersion = null;
      this.version = null;
      this.majorVersion = null;
      this.instructionSet = 'x86';
      this.device = 'workstation';
      this.cookies = false;

      var osDetectors = {
          mac: {
              is: function(ua) {
                  return (/macintosh/i.test(ua));
              },
              getVersion: function(ua){
                  var rawVersion = /Mac OS X ([\d_\.]+)[;\)]/i.exec(ua)[1];
                  return rawVersion.replace(/_/g, ".");
              }
          },
          windows: {
              is: function(ua){
                  return (/windows/i.test(ua));
              },
              getVersion: function(ua){
                  return (/windows.*?([\d\.]+?)[;\)]/i.exec(ua)[1]);
              }
          },
          solaris: {
              is: function(ua){
                  return (/sunos/i.test(ua));
              },
              getVersion: function(ua){
                  return "0";
              }
          },
          bsd: {
              is: function(ua){
                  return (/bsd/i.test(ua));
              },
              getVersion: function(ua){
                  return 0;
              }
          },
          linux: {
              is: function(ua){
                  return (/linux/i.test(ua));
              },
              getVersion: function(ua){
                  return "0";
              }
          }
      };

      var browserDetectors = {
          firefox: {
              is: function(ua){
                  return (/firefox/i.test(ua));
              },
              getVersion: function(ua){
                  return (/firefox\/(.+?)(?:\s|$)/i.exec(ua)[1]);
              },
              getMajorVersion: function(version){
                  return (/\d+/i.exec(version)[0]);
              }
          },
          chrome: {
              is: function(ua){
                  return (/chrome\//i.test(ua) && !browserDetectors.edge.is(ua) && !browserDetectors.opera.is(ua)); //trailing slash excludes chromeframe/
              },
                  getVersion: function(ua){
                      return (/chrome\/(.+?)(?:\s|$)/i.exec(ua)[1]);
                  },
                  getMajorVersion: function(version){
                      return (/\d+/i.exec(version)[0]);
                  }
          },
          safari: {
              is: function(ua){
                  return (/safari/i.test(ua) && !browserDetectors.chrome.is(ua) && !browserDetectors.edge.is(ua) && !browserDetectors.opera.is(ua));
              },
              getVersion: function(ua){
                  return (/version\/(.+?)(?:\s|$)/i.exec(ua) ? /version\/(.+?)(?:\s|$)/i.exec(ua)[1] : "6.0");
              },
              getMajorVersion: function(version){
                  return (/\d+/i.exec(version)[0]);
              }
          },
          ie: {
              is: function(ua){
                  return /msie|Trident/i.test(ua);
              },
              getVersion: function(ua){
                  // HERE BE DRAGONS
                  // IE compatibility mode can screw us up.  If we have a Trident token,
                  // parse for that. Otherwise, use "msie".  Also, Trident comes in
                  // 4.0 (IE8), 5.0 (IE9), or 6.0 (IE10) so add 4 for offset.
                  return ua.indexOf("Trident") != -1 ?
                      "" + (parseFloat(/Trident\/(.+?)[\);]/i.exec(ua)[1]) + 4) + ".0" :
                      /msie (.+?);/i.exec(ua)[1];
              },
              getMajorVersion: function(version){
                  return (/\d+/i.exec(version)[0]);
              },
              getInstructionSet: function(ua){
                  if(/x64;/i.test(ua)){
                      return 'x86-64';
                  } else {
                      return 'x86';
                  }
              }
          },
          opera: {
              is: function(ua){
                  return /(Opera|OPR)\/(\d+(\.\d+)?)/i.test(ua);
              },
              getVersion: function(ua){
                  return /OPR\/(.+?)(?:\s|$)/i.exec(ua)[1];
              },
              getMajorVersion: function(version){
                  return (/\d+/i.exec(version)[0]);
              }
          },
          edge: {
              is: function(ua){
                  return /Edge/i.test(ua);
              },
              getVersion: function(ua){
                  return /Edge\/(.+?)(?:\s|$)/i.exec(ua)[1];
              },
              getMajorVersion: function(version){
                  return /\d+/i.exec(version)[0];
              }
          }
      };

      var deviceDetectors = {
          ipad: {
              is: function(ua){
                  return (/ipad/i.test(ua));
              }
          },
          ipod: {
              is: function(ua){
                  return (/ipod/i.test(ua));
              }
          },
          iphone: {
              is: function(ua){
                  return (/iphone/i.test(ua));
              }
          },
          android: {
              is: function(ua){
                  return (/android/i.test(ua));
              }
          }
      };

      for(var deviceName in deviceDetectors){
          var deviceDetector = deviceDetectors[deviceName];
          if(deviceDetector.is(userAgent)){
              this.device = deviceName;
              break;
          }
      }

      for(var osName in osDetectors){
          var osDetector = osDetectors[osName];
          if(osDetector.is(userAgent)){
              this.os = osName;
              this.osVersion = osDetector.getVersion(userAgent);
              break;
          }
      }

      for(var browserName in browserDetectors){
          var browserDetector = browserDetectors[browserName];
          if(browserDetector.is(userAgent)){
              this.browser = browserName;
              this.version = browserDetector.getVersion(userAgent);
              this.majorVersion = browserDetector.getMajorVersion(this.version);
              if(browserDetector.getInstructionSet){
                  this.instructionSet = browserDetector.getInstructionSet(userAgent);
              }
              break;
          }
      }

      /*this.cookies = (document.cookie.indexOf('csrftoken=') > -1) || (meetingParams.CSRF == "csrftoken=28f9bacf0028e52b485f8adfb82c159b");*/
      this.cookies = window.navigator.cookieEnabled;
  };

  module.exports = new BrowserDetector();
