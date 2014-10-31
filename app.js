// dependencies
var express = require('express');
var cors = require('cors');
var app = express();

var log4js = require('log4js');
log4js.configure('log4js-config-'+app.get('env')+'.json');
var log = log4js.getLogger('esdr');

log.info("Environment: " + app.get('env'));

var config = require('./config');
var expressHandlebars = require('express-handlebars');
var path = require('path');
var favicon = require('serve-favicon');
var compress = require('compression');
var requestLogger = require('morgan');
var bodyParser = require('body-parser');
var passport = require('passport');
var Database = require("./models/Database");
var BodyTrackDatastore = require('bodytrack-datastore');

// instantiate the datastore
var datastore = new BodyTrackDatastore({
                                          binDir : config.get("datastore:binDirectory"),
                                          dataDir : config.get("datastore:dataDirectory")
                                       });

// decorate express.response with JSend methods
require('jsend-utils').decorateExpressResponse(require('express').response);

var gracefulExit = function() {
   // TODO: any way (or need?) to gracefully shut down the database pool?
   log.info("Shutting down...");
   process.exit(0);
};

// If the Node process ends, then do a graceful shutdown
process
      .on('SIGINT', gracefulExit)
      .on('SIGTERM', gracefulExit);

// start by initializing the database and getting a reference to it
Database.create(function(err, db) {
   if (err) {
      log.error("Failed to initialize the database!" + err);
   }
   else {
      log.info("Database initialized, starting app server...");

      // configure the app
      try {
         // VIEW -------------------------------------------------------------------------------------------------------------

         // setup view engine
         var viewsDir = path.join(__dirname, 'views');
         app.set('views', viewsDir);
         var handlebars = expressHandlebars.create({
                                                      extname : '.hbs',
                                                      defaultLayout : 'main-layout',
                                                      layoutsDir : path.join(viewsDir, "layouts"),
                                                      partialsDir : path.join(viewsDir, "partials"),
                                                      helpers : {
                                                         // Got this from http://stackoverflow.com/a/9405113
                                                         ifEqual : function(v1, v2, options) {
                                                            if (v1 === v2) {
                                                               return options.fn(this);
                                                            }
                                                            return options.inverse(this);
                                                         }
                                                      }
                                                   });

         app.engine('hbs', handlebars.engine);
         app.set('view engine', '.hbs');
         app.set('view cache', app.get('env') === 'production');           // only cache views in production
         log.info("View cache enabled = " + app.enabled('view cache'));

         // MIDDLEWARE -------------------------------------------------------------------------------------------------
         var oauthServer = require('./middleware/oauth2')(db.users, db.tokens);   // create and configure OAuth2 server
         var error_handlers = require('./middleware/error_handlers');

         // setup middleware
         app.use(favicon(path.join(__dirname, 'public/favicon.ico')));     // favicon serving
         app.use(requestLogger('dev'));      // request logging
         app.use(compress());                // enables gzip compression
         app.use(bodyParser.urlencoded({ extended : true }));     // form parsing
         app.use(bodyParser.json());         // json body parsing
         app.use(function(error, req, res, next) { // function MUST have arity 4 here!
            // catch invalid JSON error (found at http://stackoverflow.com/a/15819808/703200)
            res.status(400).json({status : "fail", data : "invalid JSON"})
         });
         app.use(passport.initialize());                                   // initialize passport (must come AFTER session middleware)
         app.use(express.static(path.join(__dirname, 'public')));          // static file serving

         // configure passport
         require('./middleware/auth')(db.clients, db.users, db.tokens, db.feeds);

         // ROUTING ----------------------------------------------------------------------------------------------------

         // create the FeedRouteHelper
         var FeedRouteHelper = require('./routes/api/feed-route-helper');
         var feedRouteHelper = new FeedRouteHelper(db.feeds);

         // define CORS options and apply CORS to specific route groups
         var CORS_OPTIONS = {
            origin : '*'
         };
         app.use('/oauth/*', cors(CORS_OPTIONS));
         app.use('/api/v1/*', cors(CORS_OPTIONS));

         // configure routing
         app.use('/oauth', require('./routes/oauth')(oauthServer));
         app.use('/api/v1/clients', require('./routes/api/clients')(db.clients));
         app.use('/api/v1/users', require('./routes/api/users')(db.users));
         app.use('/api/v1/products', require('./routes/api/products')(db.products, db.devices));
         app.use('/api/v1/devices', require('./routes/api/devices')(db.devices, db.feeds));
         app.use('/api/v1/feed', require('./routes/api/feed')(db.feeds, feedRouteHelper));
         app.use('/api/v1/feeds', require('./routes/api/feeds')(db.feeds, feedRouteHelper));
         app.use('/api/v1/user-verification', require('./routes/api/user-verification')(db.users));
         app.use('/api/v1/password-reset', require('./routes/api/password-reset')(db.users));
         app.use('/', require('./routes/index'));

         // ERROR HANDLERS ---------------------------------------------------------------------------------------------

         // custom 404
         app.use(error_handlers.http404);

         // dev and prod should handle errors differently: e.g. don't show stacktraces in prod
         app.use((app.get('env') === 'development') ? error_handlers.development : error_handlers.production);

         // ------------------------------------------------------------------------------------------------------------

         // set the port and start the server
         app.set('port', config.get("server:port"));
         var server = app.listen(app.get('port'), function() {
            log.info('Express server listening on port ' + server.address().port);
         });

      }
      catch (err) {
         log.error("Sever initialization failed ", err.message);
      }
   }
});
