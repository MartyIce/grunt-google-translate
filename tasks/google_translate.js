/*
 * grunt-google-translate
 * https://github.com/MartyIce/grunt-google-translate
 *
 * Copyright (c) 2014 Marty Mavis
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {

  // Please see the Grunt documentation for more information regarding task
  // creation: http://gruntjs.com/creating-tasks

    grunt.registerMultiTask('google_translate', 'Automatically generate localized json files using angular-translate source files, and Google Translate REST API', function() {

        // Merge task-specific and/or target-specific options with these defaults.
        var options = this.options({
            googleApiKey: '',
            sourceLanguageCode: 'en',
            srcPath: './il8n/**/en.json',
            restrictToLanguages: []
        });

        console.log('api: ' + options.googleApiKey);
        if(options.googleApiKey.length === 0) {
            grunt.fail.fatal('A Google API key must be provided in order to access their REST API.');
        }

        var done = this.async();

        var rest = require('restler');
        var cheerio = require('cheerio');
        var q = require('q');

        // load existing en json files
        var sourceFiles = grunt.file.expand([options.srcPath]);

        if(sourceFiles.length === 0) {
            grunt.fail.fatal('No source files found in directory \'' + options.srcPath + '\'');
        }
        for(var fileIndex = 0, fileCount = sourceFiles.length; fileIndex < fileCount; fileIndex++) {
            if(grunt.file.exists(sourceFiles[fileIndex])) {

                if(options.sourceLanguageCode !== 'en'){
                    if(sourceFiles[fileIndex].indexOf('en.json') >= 0) {
                        sourceFiles[fileIndex] = sourceFiles[fileIndex].replace('en.json', options.sourceLanguageCode + '.json');
                    }
                }

                grunt.log.writeln('we will translate: ' + sourceFiles[fileIndex]);
            }
        }


        // returns promise
        function retrieveLangDescriptions() {
            var deferred = q.defer();
            rest.get('http://en.wikipedia.org/wiki/List_of_ISO_639-1_codes').on('complete', function (result) {
                if (result instanceof Error) {
                    //console.log('Error:', result.message);
                    deferred.reject(new Error(result));
                } else {
                    var $ = cheerio.load(result);
                    var rows = $('table.wikitable > tr:has(td:has(a[href]))'); //.filter(' > td');
                    //console.log(rows.length);
                    var allLangs = [];
                    for(var i = 0, count = rows.length; i < count; i++) {
                        var lang = $(rows[i]).find('td:nth-child(3)').text();
                        var nativeName = $(rows[i]).find('td:nth-child(4)').text();
                        var code = $(rows[i]).find('td:nth-child(5)').text();
                        allLangs.push({ code: code, displayText: nativeName + ' - (' + lang + ')'});
                    }
                    deferred.resolve(allLangs);
                }
            });
            return deferred.promise;
        }
        // returns promise
        function retrieveSupportedGoogleLanguages() {
            var deferred = q.defer();

            var languages = [];
            rest.get('https://www.googleapis.com/language/translate/v2/languages?key=' + options.googleApiKey).on('complete', function(result) {
                if (result instanceof Error) {
                    console.log('Error:', result.message);
                    deferred.reject(new Error(result));
                } else {
                    grunt.log.writeln('google supports: ' + result.data.languages.length);

                    var language = null;
                    for (var i = 0, count = result.data.languages.length; i < count; i++) {
                        language = result.data.languages[i].language;
                        if(options.restrictToLanguages && options.restrictToLanguages.length > 0) {
                            if(options.restrictToLanguages.indexOf(language) >= 0) {
                                languages.push(language);
                            }
                        }
                        else {
                            languages.push(language);
                        }
                    }
                    deferred.resolve(languages);
                }
            });
            return deferred.promise;
        }
        // returns promise
        function translateFragments(fragmentsToTranslate, language) {
            var deferred = q.defer();

            if(fragmentsToTranslate.length > 0) {
                var queryString = 'https://www.googleapis.com/language/translate/v2?key=' + options.googleApiKey +
                    '&source=' + options.sourceLanguageCode +
                    '&target=' + language;
                for(var i = 0; i < fragmentsToTranslate.length; i++) {
                    queryString = queryString + '&q=' + fragmentsToTranslate[i].sourceFragment;
                }

                grunt.log.writeln();
                grunt.log.writeln(queryString);

                rest.get(queryString).on('complete', function(result) {
                    if (result instanceof Error) {
                        console.log('Error:', result.message);
                        deferred.reject(new Error(result));
                    } else {
                        deferred.resolve(result);
                    }
                });
            }
            else {
                setTimeout(function() { deferred.resolve(); });
            }

            return deferred.promise;
        }
        function findFragmentsToTranslate(sourceObject, translatedObject, fragmentsToTranslate) {
            for(var propertyName in sourceObject) {

                if(typeof sourceObject[propertyName] === 'string') {
                    if(!translatedObject.hasOwnProperty(propertyName)) {

                        fragmentsToTranslate.push(
                            { 'translatedObject' : translatedObject,
                                'propertyName' : propertyName,
                                'sourceFragment': sourceObject[propertyName]
                            });
                    }
                }
                else {
                    if(!translatedObject.hasOwnProperty(propertyName)) {
                        translatedObject[propertyName] = {};
                    }
                    findFragmentsToTranslate(sourceObject[propertyName], translatedObject[propertyName], fragmentsToTranslate);
                }
            }
        }
        function traverseLangFile(translation, language, sourceObject) {
            var deferred = q.defer();

            var fragmentsToTranslate = [];
            findFragmentsToTranslate(sourceObject, translation, fragmentsToTranslate);

            translateFragments(fragmentsToTranslate, language).then(function(result) {

                for(var i = 0, count = fragmentsToTranslate.length; i < count; i++) {
                    var frag = fragmentsToTranslate[i];
                    frag.translatedObject[frag.propertyName] = result.data.translations[i].translatedText;
                }

                deferred.resolve();
            });

            return deferred.promise;
        }
        function buildSourceFile(sourceFile, supportedLanguage) {

            var deferred = q.defer();

            var originalEnFile = grunt.file.readJSON(sourceFile);
            var translatedFile = sourceFile.replace(options.sourceLanguageCode + '.', supportedLanguage + '.');
            var translatedJson = null;

            if(grunt.file.exists(translatedFile)) {
                translatedJson = grunt.file.readJSON(translatedFile);
            }
            else {
                translatedJson = {};
            }

            // traverse file, looking for keys that aren't present, and translate
            var translation = {file: translatedFile, translation: translatedJson};
            traverseLangFile(translatedJson, supportedLanguage, originalEnFile).then(function() {
                deferred.resolve(translation);
            });

            return deferred.promise;

        }
        function buildLanguage(supportedLanguage) {

            var deferred = q.defer();

            var returnValue = { language: supportedLanguage, translations: []};

            // loop through each source file
            var promises = [];
            for(var j = 0, jcount = sourceFiles.length; j < jcount; j++) {
                promises.push(buildSourceFile(sourceFiles[j],supportedLanguage));
            }

            q.all(promises).then(function(translation) {
                returnValue.translations = returnValue.translations.concat(translation);
                deferred.resolve(returnValue);
            });

            return deferred.promise;

        }
        function buildLanguages(googleSupportedLanguages) {
            var deferred = q.defer();
            var promises = [];
            var languageTranslations = [];

            // loop through each supported language
            for(var i = 0, count = googleSupportedLanguages.length; i < count; i++) {
                promises.push(buildLanguage(googleSupportedLanguages[i]));
            }


            q.all(promises).then(function(translation) {
                languageTranslations = languageTranslations.concat(translation);
                deferred.resolve(languageTranslations);
            });
            return deferred.promise;
        }
        function findLanguageDescription(supportedLangDescriptions, language) {
            var returnValue = null;
            for(var j = 0; j < supportedLangDescriptions.length; j++) {
                if(supportedLangDescriptions[j].code === language) {
                    returnValue = supportedLangDescriptions[j];
                    break;
                }
            }
            return returnValue;
        }
        q.all([retrieveLangDescriptions(), retrieveSupportedGoogleLanguages()]).then(function(results) {

            var allLangDescriptions = results[0];
            var supportedLangDescriptions = [];
            var googleSupportedLanguages = results[1];

            grunt.log.writeln('lang descriptions: ' + allLangDescriptions.length);
            if(options.restrictToLanguages != null && options.restrictToLanguages.length > 0) {
                grunt.log.writeln('we\'re translating: ' + options.restrictToLanguages);
            }
            else {
                grunt.log.writeln('we\'re translating: ' + googleSupportedLanguages);
            }


            grunt.log.writeln('translating...');
            buildLanguages(googleSupportedLanguages).then(function(languageTranslations) {

                var langDesc = findLanguageDescription(allLangDescriptions, options.sourceLanguageCode);
                supportedLangDescriptions.splice(0, 0, langDesc);

                for(var i = 0; i < languageTranslations.length; i++) {
                    var languageTranslation = languageTranslations[i];
                    if (languageTranslation.language !== options.sourceLanguageCode) {
                        langDesc = findLanguageDescription(supportedLangDescriptions, languageTranslation.language);
                        if (!langDesc) {
                            langDesc = findLanguageDescription(allLangDescriptions, languageTranslation.language);
                            if (langDesc !== null) {
                                supportedLangDescriptions.push(langDesc);
                            }
                        }
                    }
                    for (var j = 0; j < languageTranslation.translations.length; j++) {
                        if (languageTranslation.language !== options.sourceLanguageCode) {
                            grunt.log.writeln('writing file: ' + languageTranslation.translations[j].file);
                            grunt.file.write(languageTranslation.translations[j].file, JSON.stringify(languageTranslation.translations[j].translation));
                        }
                    }
                }

                grunt.file.write('languages.json', JSON.stringify(supportedLangDescriptions));

                done();
            });
        }, function (error) {
            console.error(error);
            done();
        });
  });

};
