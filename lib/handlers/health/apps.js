var request = require('request');
var async = require('async');
var fhconfig = require('fh-config');
var logger = require('../../util/logger').getLogger();
var util = require('util');

var dfc;

var name = 'app-status';

// Default timeout: 5 seconds
var DEFAULT_TIMEOUT = 15*1000;
//var DEFAULT_HEALTH_URI = '/sys/info/health';
var DEFAULT_HEALTH_URI = '/sys/info/ping';

if (!fhconfig.value('openshift3')) {
  var fhdfc = require('fh-dfc');

  dfc = fhdfc(fhconfig.value('fhdfc'));
}

function result(id, status, error) {
  return {
    id: id,
    status: status,
    error: error
  };
}

/**
 *
 * @param dynos The list of runnning dynos
 * @param callback callback used to return the result of the operation. It must be in the format
 * cb(err, appData) where appData will be a map with this structure:
 * { appId: { dyno: dynoName, url: appUrl } }
 */
function getAppsUrl(dynos, callback) {
  var res = {};

  async.each(dynos, function (dyno, cb) {
    dfc.apps.list(dyno.dyno, 'detailed', function(err, apps) {
      async.each(apps, function (app, cb1) {

        console.log('******* APP STATE', app.app, app.state);

        if (app.state === 'RUNNING') {
          dfc.url([dyno.dyno, app.app], function (err, url) {
            res[app.app] = {'dyno': dyno.dyno, 'url': url};
            cb1();
          });
        } else {
          cb1();
        }
      }, function (err) {
        cb(err);
      });
    })
  }, function (err) {
    callback(err, res);
  });
}

/**
 * Checks that the health is ok
 * @param appData App data in the format {url: appUrl, dyno: dyno}
 * @param appName Name of the app
 * @param cb
 */
function checkAppHealth(appData, appName, cb) {
  //console.log('appName', appName, 'appData', appData);

  request({
    baseUrl: appData.url,
    uri: DEFAULT_HEALTH_URI,
    timeout: DEFAULT_TIMEOUT
  }, function(err, response, body) {

    if (err) {
      logger.error('Error invoking health check endpoint', {appName: appName, appData: appData, uri: DEFAULT_HEALTH_URI, err: err});
      return cb(result(name, 'error', 'Error invoking health check endpoint'));
    }

    if (response.statusCode !== 200) {
      logger.error('Error invoking endpoint', {appName: appName, appData: appData, err: response.statusMessage, code: response.statusCode});
      return cb(result(name, 'error', response.statusMessage)); // TODO: send data about the failing app...
    }

    var res = JSON.parse(body);

    console.log('RECEIVED STATUS: ', res);

    if (res.status === 'ok') {
      return cb(null, result(name, "OK", null));
    }

    return cb(result(name, 'error', res.error));
  });
}

function checkAppsHealth(appsData, cb) {
  async.forEachOf(appsData, checkAppHealth, function(err, res) {
    cb(err, res);
  });
}

/**
 * Checks the status of all the apps running on all the dynos
 * @param callback
 * @returns {*}
 */
function checkApps(callback) {
  async.waterfall([
      async.apply(dfc.dynos.list, 'detailed'),
      getAppsUrl,
      checkAppsHealth
    ], function(err, res) {
      console.log('result', res, 'err:', err);
      return callback(err, res);
    }
  );

  //dfc.apps.list

  //return callback(null, result('APPS', 'OK', null));
}

module.exports.checkAppsStatus=checkApps;