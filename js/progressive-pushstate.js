/*********************************************************
 * Progressive Pushstate - a library to facilitate
 * progressively enhanced pushstate/popstate enabled applications
 * with a server-side fallback.
 * 
 * by Zoltan Hawryluk (zoltan.dulac@gmail.com)
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *	 http://www.apache.org/licenses/LICENSE-2.0
 ********************************************************/


var pp = new function () {
	var me = this,
		orientation = screen.orientation || screen.mozOrientation || screen.msOrientation,
		spaceRe = /\s+/g;
	
	me.linkEls = [];
	me.formEls = [];
	me.lastState = {};
	me.popstateEvent = function (e, state) {};
	me.options = {};
	
	/*
	 * init(): called to initialize this object
	 * 
	 * popstateEvent: a method to call when the query string changes
	 * options: options to configure this object.	Values can be:
	 * 
	 * - pushScrollState: enables the application to keep track of
	 *	 scrollbar position in the app. (default: false)
	 * - debounceTime: sets the debounce time for resize/scroll events
	 *	 (default: 50)
	 * - doPopstateOnload: fire the popstateEvent onload (default: true)
	 * - defaultState: the initial default state of the application
	 *	 (default: {} or if a link with class "pp-default" exists, the
	 *	 URL of that link).
	 * 
	 */
	me.init = function (popstateEvent, options) {
		me.options = (options || {}); 
		
		// links that will update the state of the application
		me.linkEls = document.getElementsByClassName('pp-link');
		
		var formEls = document.getElementsByClassName('pp-form');
		
		// there should only be one link with this class, which
		// will have the default state of the app in the query string. 
		me.defaultEl = document.getElementsByClassName('pp-default');
		
		me.popstateEvent = popstateEvent;
		
		var linkElsLen = me.linkEls.length,
			formElsLen = formEls.length,
			i;
		
		for (i=0; i<linkElsLen; i++) {
			me.linkEls[i].addEventListener('click', linkClickEvent);
		}
		
		// We only allow changes for the first form to affect the
		// pushstate.  Multiple forms may be allowed in a future
		// release if it makes sense.
		if (formElsLen > 0) {
				me.formEl = formEls[0];
				
				var events = me.formEl.getAttribute('data-pp-events') || 'change';
				me.formChangeEventDebounced = debounce(formChangeEvent, me.options.keyDebounceTime || 500);
				
				if (events) {
					events = events.split(spaceRe);
					
					var eventsLen = events.length;
					
					for (i=0; i<eventsLen; i++) {
						var event = events[i];
						
						if (event.indexOf('key') === 0) {
							me.formEl.addEventListener(events[i], me.formChangeEventDebounced);
						} else {
							me.formEl.addEventListener(events[i], formChangeEvent);
						}
					}
				} else {
					me.formEl.addEventListener('submit', formChangeEvent);
				}
				
				
				
				if (formElsLen > 1) {
					window.console.warn('Only first form.pp-form element will affect the pushstate.');
				}
		}
		
		if (me.defaultEl.length > 0) {
			me.options.defaultState = queryStringToObject(me.defaultEl[0].href.split('?')[1]);
		}
		
		window.addEventListener('popstate', internalPopstateEvent);
		
		/*
		 * allow developers to maintain scrollbar state onScroll
		 * onResize and onorientationchange
		 */
		if (me.options.pushScrollState) {
			// We make sure we throttle scroll and resize because
			// browsers fire these events like mad and slow the browser
			// down.
			me.scrollEventDebounced = debounce(scrollEvent, me.options.debounceTime || 50);
			window.addEventListener('scroll', me.scrollEventDebounced);
			window.addEventListener('resize', me.scrollEventDebounced);
			
			// Doing screen orientation change event handling by first
			// checking for official W3C event handler, with an deprecated
			// browser fallback.	More info:
			// - https://w3c.github.io/screen-orientation/
			// - https://developer.mozilla.org/en-US/docs/Web/Events/orientationchange
			if (orientation) {
				orientation.addEventListener('change', me.scrollEvent);
			} else {
				window.addEventListener('orientationchange', me.scrollEvent);
			}
		}
		
		/*
		 * If options.doPopstateOnload exists, run the popstateEvent.
		 */
		if (me.options.doPopstateOnload && window.history.replaceState) {
			var splitLocation = location.href.split('?');
			
			if (splitLocation.length === 2) {
				var params = queryStringToObject(splitLocation[1]);
				
				window.history.replaceState(params, '', window.history.location);
				
				// if there is a form and this is not
				// a form event, let's populate the form.
				if (me.formEl !== undefined) {
					updateForm(params);
				}
				
				me.popstateEvent({
					type: 'init',
					target: document,
					currentTarget: document,
					state: params
				});
				me.lastState = params;
			}
		}
	};
	
	/* Stolen from https://github.com/rodneyrehm/viewport-units-buggyfill/blob/master/viewport-units-buggyfill.js */
	function debounce(func, wait) {
		var timeout;
		return function() {
			var context = this;
			var args = arguments;
			var callback = function() {
				func.apply(context, args);
			};
	
			clearTimeout(timeout);
			timeout = setTimeout(callback, wait);
		};
	}
	
	
	/*
	 * getScrollLeft/Top() from http://stackoverflow.com/questions/11193453/find-the-vertical-position-of-scrollbar-without-jquery
	 * This will be used in the future to ensure when traversing
	 * the browser history, that the scroll position is 
	 * maintained this library is configured to do so.
	 */
	function getScrollLeft() {
		return (window.pageXOffset !== undefined) ? window.pageXOffset : (document.documentElement || document.body.parentNode || document.body).scrollLeft;
	}
	
	function getScrollTop() {
		return (window.pageYOffset !== undefined) ? window.pageYOffset : (document.documentElement || document.body.parentNode || document.body).scrollTop;
	}
	
	function scrollEvent(e) {
		if (window.history.replaceState) {
			var url = window.history.href,
				scrollLeft = getScrollLeft(),
				scrollTop = getScrollTop(),
				state = me.lastState;

			window.history.replaceState(state, '', url);
		}
	}
	
	/*
	 * The onPopstate method handler. It runs the popstateEvent
	 * given by the application to this library after setting
	 * the event's state property.
	 */
	function internalPopstateEvent(e) {
		var state;
		
		// if the state is null and we have a default state, use that instead.
		if (me.options.defaultState !== null && e.state === null) {
			state = me.options.defaultState;
		} else {
			state = e.state;
		}
		
		// if there is a form here, let's change the form values
		// to match the query string
		if (me.formEl !== undefined) {
			updateForm(state);
		}
		
		me.popstateEvent(e, state);
		me.lastState = state;
	}
	
	function updateForm(state) {
		var i, j,
			fields = me.formEl.elements,
			numEl = fields.length,
			updatedNames = {};
		
		for (i=0; i<numEl; i++) {
			var field = fields[i],
				name = field.name,
				stateVal = state[name];
			
			// if we dealt with this name already, then go to the next item in for
			// loop.	
			if (!updatedNames[name]) {
			
				
				switch (field.type) {
					case "radio":
						var allElementsWithName = me.formEl.elements[name],
							elsLen = allElementsWithName.length;
							
						for (j=0; j<elsLen; j++) {
							var el = allElementsWithName[j];
							
							// if the value is in the stateVal array, check the box
							if (el.value === stateVal) {
								el.checked = true;
							} else {
								el.checked = false;
							}
						}
						if (field.value === state[name]) {
							field.checked = true;
						}
						break;
					case "select-multiple":
					case "checkbox":
						var allElementsWithName = me.formEl.elements[name];
						stateVal=stateVal ? stateVal.split(',') : [];
						var elsLen = allElementsWithName.length
						for (j=0; j<elsLen; j++) {
							var el = allElementsWithName[j];
							
							// if the value is in the stateVal array, check the box
							if (stateVal.indexOf(el.value) >= 0) {
								el.checked = true;
							} else {
								el.checked = false;
							}
						}
					default:
						field.value = stateVal;
				}
					
				
				updatedNames[name] = true;
			}
			
		}
	}
	/*
	 * click event that is fired on <a href="" class="pp-link">
	 * nodes.	It takes the link's URL and puts the data inside
	 * the query string into the document's popstate for the URL.
	 */
	function linkClickEvent(e) {
		var target = e.currentTarget,
			URL = target.href,
			splitURL = URL.split('?');
			
		if (splitURL.length === 2) {
			var qs = splitURL[1];
				
			e.preventDefault();
			me.updatePushState(e, qs);
			
		}
	}
	
	function formChangeEvent(e) {
		// Target is the event's current target, or the target's form element
		// since Firefox (and possibly others) have an issue with keypress on 
		// form setting the currentTarget correctly.
		var target = e.currentTarget || e.target.form,
			qs = me.formData2QueryString(target, {
				collapseMulti: me.options.collapseMulti
			});
			
		me.updatePushState(e, qs);
		
		if (e.type === 'submit') {
			var autoFocusEl = me.formEl.querySelector('input[autofocus], textarea[autofocus], select[autofocus]');
			
			if (autoFocusEl) {
				autoFocusEl.focus();
			}
		}
	}
	
	/*
	 * grabs the URL without the query string from the browser.
	 */
	function getBaseUrl() {
		var loc = window.location;
		return loc.protocol + "//" + loc.host + loc.pathname;
	};
	
	/*
	 * Takes a query string and returns the string converted
	 * into a JavaScript object.	If the query string has a 
	 * hash anchor in it, it is put in the object's _ppHash
	 * parameter.
	 */
	function queryStringToObject(qs) {
		var hashSplit = qs.split('#'),
			keyVals = hashSplit[0].split('&'),
			keyValsLen = keyVals.length,
			i, r = {};
		
		for (i=0; i<keyValsLen; i++) {
			var keyVal = keyVals[i],
				splitVal = keyVal.split('=');
			
			r[decodeURIComponent(splitVal[0])] = decodeURIComponent(splitVal[1]);
		}
		
		if (hashSplit.length > 1) {
			r._ppHash = hashSplit[1];
		}
		return r;
	}
	
	/*
	 * Takes a JavaScript object and converts it into a query string.
	 */
	function objectToQueryString(obj) {
		var i, sb = [];
		
		for (i in obj) {
			sb.push(encodeURIComponent(i) + '=' + encodeURIComponent(obj[i]));
			
		}
		
		return sb.join('&');
	}
	
	/*
	 * Takes a query string and hash value and puts 
	 * it into the history's pushstate.	For example:
	 * 
	 * qs -> "this=1&that=2&other=3"
	 * hash -> myLinkName
	 * 
	 * will put this into the pushstate:
	 * 
	 * {
	 * 		this: '1',
	 *		that: '2',
	 *		other: '3',
	 *		_ppHash: 'myLinkName'
	 * } 
	 */
	me.updatePushState = function (e, qs) {
		var target = e.currentTarget;
		
		switch (e.type) {
			
			case 'submit':
			case 'click':
				e.preventDefault();
				break;
		}
		
		var params = queryStringToObject(qs);
		
		/* Insert the how many pages in history this page is */
		if (me.lastState._ppPageNum === undefined && e.state === undefined) {
			params._ppPageNum = 0;
		} else if (e.type !== 'popstate') {
			params._ppPageNum = me.lastState._ppPageNum + 1;
		}
		
		if (window.history.pushState) {
			var newUrl = getBaseUrl() + '?' + qs;
			window.history.pushState(params, '', newUrl);
			
			e.state = params;
			
			// if there is a form and this is not
			// a form event, let's populate the form.
			if (me.formEl !== undefined && e.currentTarget !== me.formEl) {
				updateForm(params);
			}
			
			me.popstateEvent(e, params);
			me.lastState = params;
			
		}
	};
	
	/*
	 * This will be used in the future to compare two states to see if 
	 * they are equal.
	 */
	me.sortObject = function(obj) {
		return Object.keys(obj).sort().reduce(function (result, key) {
			result[key] = obj[key];
			return result;
		}, {});
	};
	
	/*
	 * Serializes the data from all the inputs in a Web form
	 * into a query-string style string.
	 * @param docForm -- Reference to a DOM node of the form element
	 * @param formatOpts -- JS object of options for how to format
	 * the return string. Supported options:
	 *		collapseMulti: (Boolean) take values from elements that
	 *		can return multiple values (multi-select, checkbox groups)
	 *		and collapse into a single, comman-delimited value
	 *		(e.g., thisVar=asdf,qwer,zxcv)
	 * @returns query-string style String of variable-value pairs
	 * 
	 * Original code by Matthew Eernisse (mde@fleegix.org), March 2005
	 * Additional bugfixes by Mark Pruett (mark.pruett@comcast.net), 12th July 2005
	 * Multi-select added by Craig Anderson (craig@sitepoint.com), 24th August 2006
	 * HTML5 Form Element Support added by Zoltan Hawryluk (zoltan.dulac@gmail.com)
	 *
	*/

	me.formData2QueryString = function (docForm, formatOpts) {	
		var opts = formatOpts || {},
			str = '',
			formElem,
			lastElemName = '';
		
		for (i = 0; i < docForm.elements.length; i++) {
			formElem = docForm.elements[i];
	
			if (formElem.name) {
				switch (formElem.type) {
				
					// Multi-option select
					case 'select-multiple':
						var isSet = false;
						for(var j = 0; j < formElem.options.length; j++) {
							var currOpt = formElem.options[j];
							if(currOpt.selected) {
								if (opts.collapseMulti) {
									if (isSet) {
										str += ',' + encodeURIComponent(currOpt.value);
									}
									else {
										str += formElem.name + '=' + encodeURIComponent(currOpt.value);
										isSet = true;
									}
								}
								else {
									str += formElem.name + '=' + encodeURIComponent(currOpt.value) + '&';
								}
							}
						}
						if (opts.collapseMulti) {
							str += '&';
						}
						break;
					
					// Radio buttons
					case 'radio':
						if (formElem.checked) {
							str += formElem.name + '=' + encodeURIComponent(formElem.value) + '&';
						}
						break;
						
					// Checkboxes
					case 'checkbox':
						if (formElem.checked) {
							// Collapse multi-select into comma-separated list
							if (opts.collapseMulti && (formElem.name == lastElemName)) {
								// Strip of end ampersand if there is one
								if (str.lastIndexOf('&') == str.length-1) {
									str = str.substr(0, str.length - 1);
								}
								// Append value as comma-delimited string
								str += ',' + encodeURIComponent(formElem.value);
							}
							else {
								str += formElem.name + '=' + encodeURIComponent(formElem.value);
							}
							str += '&';
							lastElemName = formElem.name;
						}
						break;
					// Text fields, hidden form elements, passwords, textareas, single
					// select elements, range, date and color.  Note that we use 
					// default here in order to catch
					// others that may not be defined yet.
					default:
						str += formElem.name + '=' + encodeURIComponent(formElem.value) + '&';
						break;
				}
			}
		}
		// Remove trailing separator
		str = str.substr(0, str.length - 1);
		return str;
	};

};

