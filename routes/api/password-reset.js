var config = require('../../config');
var express = require('express');
var router = express.Router();
var passport = require('passport');
var Mailer = require('../../lib/mailer');
var ValidationError = require('../../lib/errors').ValidationError;
var httpStatus = require('http-status');
var log = require('log4js').getLogger();

module.exports = function(UserModel, ClientModel) {

   router.post('/',
               function(req, res) {
                  var userEmail = (req.body.user) ? req.body.user.email : null;
                  var theClient = req.body.client;

                  // The client is required--try to authenticate it
                  if (userEmail) {
                     if (theClient) {
                        ClientModel.findByNameAndSecret(theClient.clientName, theClient.clientSecret, function(err, client) {
                           if (err) {
                              return res.jsendServerError("Error while authenticating client [" + theClient.clientName + "]");
                           }
                           if (!client) {
                              return res.jsendClientError("Failed to authenticate client.", {clientName : theClient.clientName}, httpStatus.UNAUTHORIZED);  // HTTP 401 Unauthorized
                           }

                           // try to create the reset password token
                           UserModel.createResetPasswordToken(userEmail, function(err, token) {
                              if (err) {
                                 if (err instanceof ValidationError) {
                                    return res.jsendClientValidationError("Invalid email address.", {email : userEmail});  // HTTP 422 Unprocessable Entity
                                 }
                                 var message = "Error while trying create a reset password token request";
                                 log.error(message + ": " + err);
                                 return res.jsendServerError(message);
                              }

                              if (token) {

                                 var obj = {
                                    email : userEmail
                                 };
                                 // See whether we should return the reset password token.  In most cases, we simply want to
                                 // email the reset password token to the user (see below). But, when testing, just
                                 // return it here so I don't have to write tests that check an email account :-)
                                 if (config.get("resetPasswordToken:willReturnViaApi")) {
                                    obj.resetPasswordToken = token
                                 }

                                 if (config.get("resetPasswordToken:willEmailToUser")) {
                                    Mailer.sendPasswordResetEmail(client, userEmail, token);
                                 }
                                 return res.jsendSuccess(obj, httpStatus.CREATED);  // HTTP 201 Created
                              }

                              return res.jsendClientError("Unknown email address", {email : userEmail}, httpStatus.BAD_REQUEST);  // HTTP 400 Bad Request
                           });
                        });
                     }
                     else {
                        return res.jsendClientValidationError("Client not specified.", null);  // HTTP 422 Unprocessable Entity
                     }
                  }
                  else {
                     return res.jsendClientValidationError("Email address not specified.", null);  // HTTP 422 Unprocessable Entity
                  }
               }
   );

   router.put('/',
              function(req, res) {
                 var password = req.body.password;
                 var token = req.body.token;

                 if (password) {
                    if (token) {
                       UserModel.setPassword(token, password, function(err, wasSuccessful) {
                          if (err) {
                             if (err instanceof ValidationError) {
                                return res.jsendClientValidationError("Validation failure", err.data);  // HTTP 422 Unprocessable Entity
                             }
                             var message = "Error while trying set the new password";
                             log.error(message + ": " + err);
                             return res.jsendServerError(message);
                          }

                          if (wasSuccessful) {
                             return res.jsendSuccess(null);
                          }

                          return res.jsendClientError("Unknown or invalid reset password token", null, httpStatus.BAD_REQUEST);  // HTTP 400 Bad Request
                       });
                    }
                    else {
                       return res.jsendClientValidationError("Reset password token not specified.", null);  // HTTP 422 Unprocessable Entity
                    }
                 }
                 else {
                    return res.jsendClientValidationError("Password not specified.", null);  // HTTP 422 Unprocessable Entity
                 }
              }
   );

   return router;
};
