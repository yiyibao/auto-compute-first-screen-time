var MutationObserver = window.MutationObserver || window.WebKitMutationObserver || window.MozMutationObserver;

var acftGlobal = require('./global-info');

var SLICE = Array.prototype.slice;

module.exports = {
    version: '5.4.4',

    getDomReadyTime: function (_global, callback) {
        if (_global._isUsingOriginalNavStart) {
            var count = 0;
            var handler = function () {
                if (performance.timing.domContentLoadedEventStart != 0) {
                    callback(performance.timing.domContentLoadedEventStart, 'domContentLoadedEventStart');
                }

                if (++count >= 50 || performance.timing.domContentLoadedEventStart != 0) {
                    clearInterval(timer);
                }
            };
            // 轮询获取 domComplete 的值，最多轮询 10 次
            var timer = setInterval(handler, 500);

            handler();   
        } else {
            if (_global.domUpdateTimeStamp) {
                callback(_global.domUpdateTimeStamp, 'domUpdateTimeStamp');
            } else {
                callback(_global.forcedNavStartTimeStamp, 'forcedNavStartTimeStamp');
            }
        }
    },

    getImgSrcFromDom: function (dom, imgFilter) {
        var src;

        if (dom.nodeName.toUpperCase() == 'IMG') {
            src = dom.getAttribute('src');
        } else {
            var computedStyle = window.getComputedStyle(dom);
            var bgImg = computedStyle.getPropertyValue('background-image') || computedStyle.getPropertyValue('background');

            var match = bgImg.match(/url\(.+\)/);
            var str = match && match[0];
            if (str) {
                str = str.replace(/^url\([\'\"]?/, '').replace(/[\'\"]?\)$/, '');

                if ((/^http/.test(str) || /^\/\//.test(str)) && this._filteImg(str, imgFilter)) {
                    src = str;
                }
            }
        }

        return src;
    },

    _filteImg: function (src, imgFilter) {
        for (var i = 0, len = imgFilter.length; i < len; i++) {
            if (imgFilter[i].test(src)) {
                return true;
            }
        }

        return false;
    },

    currentPos: {
        scrollTop: 0,
        top: 0,
        bottom: 0,
        left: 0,
        right: 0
    },

    recordCurrentPos: function (currentNode, _global) {
        var boundingClientRect = currentNode.getBoundingClientRect();

        var scrollWrapper = document.querySelector(_global.scrollWrapper);
        var scrollTop;

        // 优先使用加了 perf-scroll 标志的 dom 节点作为滚动容器
        if (scrollWrapper) {
            var scrollWrapperClientRect = scrollWrapper.getBoundingClientRect();

            if (scrollWrapperClientRect.top < 0) {
                scrollTop = -scrollWrapperClientRect.top;
            } else {
                scrollTop = 0;
            }
        } else {
            scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
        }

        var top = boundingClientRect.top; // getBoundingClientRect 会引起重绘
        var bottom = boundingClientRect.bottom;
        var left = boundingClientRect.left;
        var right = boundingClientRect.right;

        this.currentPos.scrollTop = scrollTop;
        this.currentPos.top = top;
        this.currentPos.bottom = bottom;
        this.currentPos.left = left;
        this.currentPos.right = right;
    },

    isInFirstScreen: function (currentNode) {
        // 如果已不显示（display: none），top 和 bottom 均为 0
        if (!this.currentPos.top && !this.currentPos.bottom) {
            return false;
        }

        var screenHeight = window.innerHeight;
        var screenWidth = window.innerWidth;

        var scrollTop = this.currentPos.scrollTop;
        var top = this.currentPos.top;
        var left = this.currentPos.left;
        var right = this.currentPos.right;

        // 如果在结构上的首屏内（上下、左右）
        if ((scrollTop + top) < screenHeight && right > 0 && left < screenWidth) {
            return true;
        }

        return false;
    },
    queryAllNode: function (ignoreTag) {
        var that = this;

        var result = document.createNodeIterator(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            function (node) {
                // 判断该元素及其父元素是否是需要忽略的元素
                if (!that._shouldIgnoreNode(node, ignoreTag)) {
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        return result;
    },
    _shouldIgnoreNode: function (child, ignoreTag) {
        var ignoredNodes = document.querySelectorAll(ignoreTag);

        for (var i = 0, len = ignoredNodes.length; i < len; i++) {
            if (this._isChild(child, ignoredNodes[i])) {
                return true;
            }
        }

        return false;
    },

    _isChild: function (child, parent) {
        var isChild = false;

        while (child) {
            if (child === parent) {
                isChild = true;
                break;
            }

            child = child.parentNode;
        }

        return isChild;
    },
    parseUrl: function (url) {
        var anchor = document.createElement('a');
        anchor.href = url;
        return anchor;
    },
    transRequestDetails2Arr: function (_global) {
        var requests = [];
        var requestItem = {};

        // 规范化 requests
        for (var requestDetailKey in _global.requestDetails) {
            var parsedRequestDetailKey = requestDetailKey
                .split(">time")[0]
                .replace(/^http(s)?:/, '')
                .replace(/^\/\//, '');

            requestItem = {
                src: parsedRequestDetailKey
            };

            for (var requestItemkey in _global.requestDetails[requestDetailKey]) {
                requestItem[requestItemkey] = _global.requestDetails[requestDetailKey][requestItemkey];
            }

            requests.push(requestItem);
        }

        return requests;
    },

    formateUrlByRemove: function (url) {
        return url.replace(/^http(s)?\:/, '').replace(/^\/\//, '');
    },

    formateUrlByAdd: function (url) {
        if (/^http/.test(url)) {
            return url;
        }

        if (/^\/\//.test(url)) {
            return window.location.protocol + url;
        }

        return window.location.protocol + '//' + url;
    },

    initGlobal: function () {
        return {
            // 是否已经上报的标志
            stopCatchingRequest: false,

            // 是否抓取过请求的标志位
            isFirstRequestSent: false,

            // 可以抓取请求的时间窗口队列
            catchRequestTimeSections: [],

            // 统计没有被计入首屏的图片有哪些，和更详细的信息
            ignoredImages: [],

            // 设备信息，用于样本分析
            device: {},

            requestDetails: {},

            delayAll: 0,

            ignoreTag: '[perf-ignore]',

            scrollWrapper: '[perf-scroll]',

            // 记录 url 改变的历史，用于单页应用性能监控
            urlChangeStore: [],

            // 是否已经上报
            hasReported: false,

            // 描述上报类型，默认是空
            reportDesc: '',

            // 记录 dom 更新的时间
            domUpdateTimeStamp: 0,

            // 手动上报运行的时刻
            handExcuteTime: 0,

            // 计算首屏时间耗时的开始时刻，默认是 navigationStart，对于单页应用，该值有可能修改
            forcedNavStartTimeStamp: window.performance.timing.navigationStart,

            _originalNavStart: window.performance.timing.navigationStart,

            _isUsingOriginalNavStart: true,

            abortReport: false,

            onReport: function () { },

            onStableStatusFound: function () { },

            onNavigationStartChange: function() {},

            request: {
                limitedIn: [],
                exclude: [/(sockjs)|(socketjs)|(socket\.io)/]
            },

            // 获取数据后，认为渲染 dom 的时长；同时也是串联请求的等待间隔
            renderTimeAfterGettingData: 500,

            // onload 之后延时一段时间，如果到期后仍然没有异步请求发出，则认为是纯静态页面
            watingTimeWhenDefineStaticPage: 2000,

            img: [/(\.)(png|jpg|jpeg|gif|webp)/i], // 匹配图片的正则表达式

            // 监听 body 标签上的 tag 发生变化，如果设置为 true，那么，每次变化均触发首屏时间的自动计算。主要用于单页应用计算首屏
            watchPerfStartChange: true,

            // 延时执行上报
            delayReport: 0,

            domChangeList: [],

            navigationStartChangeTag: ['data-perf-start', 'perf-start'],

            // tag 变化防抖，200ms 以内的频繁变化不被计算
            navigationStartChangeDebounceTime: 200,

            domUpdateMutationObserver: null,

            scriptLoadingMutationObserver: null,

            // 用于拦截 jsonp 请求，js url 匹配该正则时
            jsonpFilter: /callback=jsonp/,

            reportTimeFrom: ''
        }
    },

    getTime: function () {
        return new Date().getTime();
    },

    mergeGlobal: function (defaultGlobal, privateGlobal) {
        var key;
        for (key in privateGlobal) {
            defaultGlobal[key] = privateGlobal[key];
        }

        return defaultGlobal;
    },

    forEach: function(arr, callback) {
        if (typeof arr === 'object' && arr.length) {
            for (var i = 0, len = arr.length; i < len; i++) {
                callback(arr[i], i);
            }
        }
    },

    overrideRequest: function (_global, onStable) {
        var that = this;
        var requestTimerStatusPool = {};

        // 用于统计 js 请求（不含 jsonp）
        var scriptRequestPool = {};

        var hasAllReuestReturned = function () {
            for (var key in _global.requestDetails) {
                if (_global.requestDetails[key] && _global.requestDetails[key].status !== 'complete') {
                    return false;
                }
            }

            return true;
        };

        var isRequestTimerPoolEmpty = function () {
            for (var key in requestTimerStatusPool) {
                if (requestTimerStatusPool[key] !== 'stopped') {
                    return false;
                }
            }

            return true;
        };

        var shouldCatchThisRequest = function (url) {
            // 默认抓取该请求到队列，认为其可能影响首屏
            var shouldCatch = true;

            if (_global.stopCatchingRequest) {
                shouldCatch = false;
            }

            var sendTime = that.getTime();

            // 如果发送数据请求的时间点在时间窗口内，则认为该抓取该请求到队列，主要抓取串联型请求
            for (var sectionIndex = 0; sectionIndex < _global.catchRequestTimeSections.length; sectionIndex++) {
                var poolItem = _global.catchRequestTimeSections[sectionIndex];
                if (sendTime >= poolItem[0] && sendTime <= poolItem[1]) {
                    break;
                }
            }
            if (_global.catchRequestTimeSections.length && sectionIndex === _global.catchRequestTimeSections.length) {
                shouldCatch = false;
            }

            // 如果发送请求地址不符合白名单和黑名单规则。则认为不该抓取该请求到队列
            for (var i = 0, len = _global.request.limitedIn.length; i < len; i++) {
                if (!_global.request.limitedIn[i].test(url)) {
                    shouldCatch = false;
                }
            }

            for (var i = 0, len = _global.request.exclude.length; i < len; i++) {
                if (_global.request.exclude[i].test(url)) {
                    shouldCatch = false;
                }
            }

            return shouldCatch;
        }

        var ensureRequestDetail = function (requestKey) {
            if (!_global.requestDetails[requestKey]) {
                _global.requestDetails[requestKey] = {
                    status: '',
                    completeTimeStamp: '',
                    completeTime: '',
                    type: ''
                };
            }
        };

        var onRequestSend = function (url, type) {
            if (!_global.isFirstRequestSent) {
                _global.isFirstRequestSent = true;
            }

            var requestKey = url + '>time:' + that.getTime();
            ensureRequestDetail(requestKey);

            _global.requestDetails[requestKey].status = 'sent';
            _global.requestDetails[requestKey].type = type;

            requestTimerStatusPool[requestKey] = 'start';

            return {
                requestKey: requestKey
            }
        };

        var afterRequestReturn = function (requestKey) {
            //  当前时刻
            var returnTime = that.getTime();

            ensureRequestDetail(requestKey);

            // 标记这个请求完成
            _global.requestDetails[requestKey].status = 'complete';
            _global.requestDetails[requestKey].completeTimeStamp = returnTime;
            _global.requestDetails[requestKey].completeTime = returnTime - _global.forcedNavStartTimeStamp;

            // 从这个请求返回的时刻起，延续一段时间，该时间段内的请求也需要被监听
            _global.catchRequestTimeSections.push([returnTime, returnTime + _global.renderTimeAfterGettingData]);

            var renderDelayTimer = setTimeout(function () {
                requestTimerStatusPool[requestKey] = 'stopped';
                if (hasAllReuestReturned() && isRequestTimerPoolEmpty()) {
                    onStable();
                }
                clearTimeout(renderDelayTimer);
            }, _global.renderTimeAfterGettingData);
        };

        var overideXhr = function (onRequestSend, afterRequestReturn) {
            var XhrProto = XMLHttpRequest.prototype;
            var oldXhrSend = XhrProto.send;
            XhrProto.send = function () {
                if (shouldCatchThisRequest(this._http.url)) {
                    var requestKey = onRequestSend(this._http.url, 'xhr').requestKey;

                    var oldReadyCallback = this.onreadystatechange;
                    this.onreadystatechange = function () {
                        if (this.readyState === 4) {
                            afterRequestReturn(requestKey);
                        }

                        if (oldReadyCallback && oldReadyCallback.apply) {
                            oldReadyCallback.apply(this, arguments);
                        }
                    };
                }

                return oldXhrSend.apply(this, SLICE.call(arguments));
            };
        };
        
        var overrideFetch = function (onRequestSend, afterRequestReturn) {
            if (window.fetch && typeof Promise === 'function') {
                // ensure Promise exists. If not, skip cathing request
                var oldFetch = window.fetch;
                window.fetch = function () {
                    var that = this;
                    var args = arguments;

                    return new Promise(function (resolve, reject) {
                        var url;
                        var requestKey;

                        if (typeof args[0] === 'string') {
                            url = args[0];
                        } else if (typeof args[0] === 'object') { // Request Object
                            url = args[0].url;
                        }

                        // when failed to get fetch url, skip report
                        if (url) {
                            // console.warn('[auto-compute-first-screen-time] no url param found in "fetch(...)"');
                            requestKey = onRequestSend(url, 'fetch').requestKey;
                        }

                        oldFetch.apply(that, args).then(function (response) {
                            if (requestKey) {
                                afterRequestReturn(requestKey);
                            }
                            resolve(response);
                        }).catch(function (err) {
                            if (requestKey) {
                                afterRequestReturn(requestKey);
                            }
                            reject(err);
                        });
                    })
                };
            }
        };

        var overrideJsonp = function (onRequestSend, afterRequestReturn) {
                var requestMap = {};
                var responseMap = {};

                var getScriptSrc = function (node) {
                    if (/script/i.test(node.tagName) && /^http/.test(node.src)) {
                        return node.src;
                    }
                    return '';
                };

                var afterLoadOrErrorOrTimeout = function (requestKey) {
                    if (!responseMap[requestKey]) {
                        responseMap[requestKey] = true;
                        afterRequestReturn(requestKey);
                    }
                }

                var addLoadWatcher = function (node) {
                    var src = getScriptSrc(node);

                    if (!src) {
                        return;
                    }

                    // filter jsonp script url
                    if (!_global.jsonpFilter.test(src)) {
                        return;
                    }

                    if (!requestMap[src]) {
                        requestMap[src] = true;

                        var requestKey = onRequestSend(src, 'jsonp').requestKey;

                        // 超时时间为 3000
                        var timeoutTimer = setTimeout(function () {
                            afterLoadOrErrorOrTimeout(requestKey);
                            clearTimeout(timeoutTimer);
                        }, 3000);

                        if (node.readyState) { // IE
                            node.addEventListener('readystatechange', function () {
                                if (script.readyState == 'loaded' || script.readyState == 'complete') {
                                    afterLoadOrErrorOrTimeout(requestKey);
                                    clearTimeout(timeoutTimer);
                                }
                            });
                        }
                        else { // Others
                            node.addEventListener('load', function () {
                                afterLoadOrErrorOrTimeout(requestKey);
                                clearTimeout(timeoutTimer);
                            });
                            node.addEventListener('error', function () {
                                afterLoadOrErrorOrTimeout(requestKey);
                                clearTimeout(timeoutTimer);
                            });
                        }
                    }

                };

                
                var queryScriptNode = function(callback) {
                    var scripts = document.getElementsByTagName('script');
                    var scriptsArray = SLICE.call(scripts, 0);

                    for (var i = 0, len = scriptsArray.length; i < len; i++) {
                        callback(scriptsArray[i]);
                    }
                };

                if (MutationObserver) {
                    _global.scriptLoadingMutationObserver = new MutationObserver(function (mutations, observer) {
                        that.forEach(mutations, function (mutation) {
                            if (mutation.addedNodes) {
                                that.forEach(mutation.addedNodes, function (addedNode) {
                                    addLoadWatcher(addedNode);
                                });
                            }
                        });
                    });
                    _global.scriptLoadingMutationObserver.observe(document.body, {
                        attributes: false,
                        childList: true,
                        subtree: true
                    });

                    queryScriptNode(function (scriptNode) {
                        addLoadWatcher(scriptNode);
                    });
                } else {
                    _global.scriptLoadingMutationObserverMockTimer = setInterval(function () {
                        queryScriptNode(function(scriptNode) {
                            addLoadWatcher(scriptNode);
                        });
                    }, 200);

                    queryScriptNode(function (scriptNode) {
                        addLoadWatcher(scriptNode);
                    });
                }
        };

        // overide fetch first, then xhr, because fetch could be mocked by xhr
        overrideFetch(onRequestSend, afterRequestReturn);

        overideXhr(onRequestSend, afterRequestReturn);
        
        overrideJsonp(onRequestSend, afterRequestReturn);
    },

    stopCatchingRequest: function (_global) {
        if (_global.scriptLoadingMutationObserverMockTimer) {
            clearInterval(_global.scriptLoadingMutationObserverMockTimer);
        }
        if (_global.scriptLoadingMutationObserver) {
            _global.scriptLoadingMutationObserver.disconnect();
        }
    },

    mergeUserConfig: function (_global, userConfig) {
        if (userConfig) {
            for (var userConfigKey in userConfig) {
                if (['watingTimeWhenDefineStaticPage', 'onReport', 'onStableStatusFound', 'renderTimeAfterGettingData', 'onAllXhrResolved', 'onNavigationStartChange', 'watchPerfStartChange', 'forcedNavStartTimeStamp', 'delayReport', 'navigationStartChangeTag', 'jsonpFilter'].indexOf(userConfigKey) !== -1) {
                    _global[userConfigKey] = userConfig[userConfigKey];
                }
            }

            var requestConfig = userConfig.request || userConfig.xhr;
            if (requestConfig) {
                if (requestConfig.limitedIn) {
                    _global.request.limitedIn = _global.request.limitedIn.concat(requestConfig.limitedIn);
                }
                if (requestConfig.exclude) {
                    _global.request.exclude = _global.request.exclude.concat(requestConfig.exclude);
                }
            }

            if (userConfig.img) {
                if (typeof userConfig.img === 'object' && typeof userConfig.img.test === 'function') {
                    _global.img.push(userConfig.img);
                } else {
                    console.error('[auto-compute-first-screen-time] param "img" should be type RegExp');
                }
            }
        }

        // 不用全等，避免字符串和数字之间不相等的情况
        _global._isUsingOriginalNavStart = _global.forcedNavStartTimeStamp == _global._originalNavStart;
    },

    testStaticPage: function (onStable, _global) {
        var handler = function () {
            acftGlobal.onloadFinished = true;

            // 如果脚本运行完毕，延时一段时间后，再判断页面是否发出异步请求，如果页面还没有发出异步请求，则认为该时刻为稳定时刻，尝试上报
            var timer = setTimeout(function () {
                clearTimeout(timer);

                if (!_global.isFirstRequestSent) {
                    onStable();
                }
            }, _global.watingTimeWhenDefineStaticPage);
        };

        if (acftGlobal.onloadFinished) {
            handler();
        } else {
            window.addEventListener('load', handler);
        }
    },

    watchDomUpdate: function (_global) {
        if (MutationObserver) {
            _global.domUpdateMutationObserver = new MutationObserver(function () {
                _global.domUpdateTimeStamp = new Date().getTime();
                _global.domChangeList.unshift({
                    timeStamp: _global.domUpdateTimeStamp,
                    duration: _global.domUpdateTimeStamp - _global.forcedNavStartTimeStamp
                });
            });
            _global.domUpdateMutationObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    },
    stopWatchDomUpdate: function (_global) {
        if (_global.domUpdateMutationObserver) {
            _global.domUpdateMutationObserver.disconnect();
        }
    },

    onNavigationStartChange: function (_lanchGlobal, callback) {
        var that = this;

        if (_lanchGlobal.watchPerfStartChange && !acftGlobal.watchingNavStartChange) {
            acftGlobal.watchingNavStartChange = true; // 一个页面，只允许一个观察者

            var getTagValue = function (navigationStartChangeTag) {
                var value;
                for (var i = 0, len = navigationStartChangeTag.length; i < len; i++) {
                    value = document.body.getAttribute(navigationStartChangeTag[i]);

                    if (value) {
                        return value;
                    }
                }

                return '';
            };

            var hasChanged = function(pre, cur) {
                // 当前有值，且和之前的值不同（之前的值可以为空），认为变化了
                if (cur && cur != pre) {
                    return true;
                }

                // 当前无值，但之前有值，认为变化了
                if (!cur && pre) {
                    return true;
                }

                return false;
            }

            var preTagValue;
            var curTagValue;

            var realChangeList = acftGlobal.navigationTagChangeMap.realChangeList;
            var usedChangeList = acftGlobal.navigationTagChangeMap.usedChangeList;
            var checkShouldRunCallback = function() {
                var curTagValue = getTagValue(_lanchGlobal.navigationStartChangeTag);

                if (hasChanged(preTagValue, curTagValue)) {
                    var currentTimeStamp = new Date().getTime();

                    var changeInfo = {
                        preTagValue: preTagValue,
                        curTagValue: curTagValue,
                        value: curTagValue,
                        timeStamp: currentTimeStamp,
                        time: currentTimeStamp - _lanchGlobal._originalNavStart
                    };

                    // 记录真实的变化情况
                    realChangeList.push(changeInfo);

                    preTagValue = curTagValue;
                    
                    if (realChangeList.length === 1) { // 第 1 次变化，不触发 callback
                        usedChangeList.push(changeInfo);
                    } else { // 第 2 次和更多的变化
                        var usedListLength = usedChangeList.length;
                        var preUsedTime = usedChangeList[usedListLength - 1].timeStamp;

                        // 防抖，如果在一段时间内触发了多次变化，只取初始变化的那一次
                        if (currentTimeStamp - preUsedTime >= _lanchGlobal.navigationStartChangeDebounceTime) {
                            usedChangeList.push(changeInfo);
                            callback(changeInfo);
                        }
                    }
                }
            };

            if (MutationObserver) {
                var observer = new MutationObserver(function (mutations, observer) {
                    that.forEach(mutations, function (mutation, index) {
                        if (_lanchGlobal.navigationStartChangeTag.indexOf(mutation.attributeName) !== -1) {
                            checkShouldRunCallback();
                        }
                    });
                });
                observer.observe(document.body, { 
                    attributes: true,
                    childList: false,
                    subtree: false
                });
            } else {
                setInterval(checkShouldRunCallback, 250);
            }
        }
    },

    cycleGettingPerformaceTime: function (_global, firstScreenImages, callback) {
        var maxFetchTimes = 50;
        var fetchCount = 0;
        var formattedFirstScreenImages = firstScreenImages.map(this.formateUrlByRemove);
        var that = this;

        var getPerformanceTime = function () {
            var source = performance.getEntries();
            var matchedLength = 0;
            var i;
            var len;

            var firstScreenImagesDetail = []; // reset

            // source 去重
            var filteredSource = [];
            var sourceMap = {};
            for (i = 0, len = source.length; i < len; i++) {
                var sourceItem = source[i];
                var url = sourceItem.name;
                if (!sourceMap[url]) {
                    sourceMap[url] = true;
                    filteredSource.push(sourceItem);
                }
            }

            // 从 source 中找到图片加载信息
            for (i = 0, len = filteredSource.length; i < len; i++) {
                var sourceItem = filteredSource[i];
                var imgUrl = sourceItem.name;
                if (formattedFirstScreenImages.indexOf(that.formateUrlByRemove(imgUrl)) !== -1) {
                    matchedLength++;

                    var responseEnd = parseInt(sourceItem.responseEnd);
                    var fetchStart = parseInt(sourceItem.fetchStart);
                    firstScreenImagesDetail.push({
                        src: imgUrl,
                        responseEnd: responseEnd < 0 ? 0 : responseEnd,
                        fetchStart: fetchStart < 0 ? 0 : fetchStart,
                        from: 'performance'
                    });
                }
            }

            // 倒序
            firstScreenImagesDetail.sort(function (a, b) {
                return b.responseEnd - a.responseEnd;
            });

            if (matchedLength === firstScreenImages.length) {
                clearInterval(timer);

                callback({
                    firstScreenTime: parseInt(firstScreenImagesDetail[0].responseEnd),
                    firstScreenTimeStamp: parseInt(firstScreenImagesDetail[0].responseEnd) + _global._originalNavStart,
                    firstScreenImagesDetail: firstScreenImagesDetail
                });
            }

            fetchCount++;
            if (fetchCount >= maxFetchTimes) {
                clearInterval(timer);
            }
        };

        // 轮询多次获取 performance 信息，直到 performance 信息能够展示首屏资源情况
        var timer = setInterval(getPerformanceTime, 1000);

        getPerformanceTime();
    },
    getByOnload: function (_global, firstScreenImages, callback, getFromPerformance) {
        var that = this;
        var firstScreenImagesDetail = [];

        var afterLoad = function (src, loadType) {
            var now = new Date().getTime();

            firstScreenImagesDetail.push({
                src: src,
                responseEnd: now - _global.forcedNavStartTimeStamp,
                fetchStart: 'unkown',
                type: loadType
            });
        };

        var protocol = window.location.protocol;

        var shouldGetFromPerformance = true;

        var count = 0;
        that.forEach(firstScreenImages, function (src) {
            var img = new Image();

            img.src = that.formateUrlByAdd(src);

            if (img.complete) {
                count++;
                afterLoad(src, 'complete');
            } else {
                shouldGetFromPerformance = false;

                img.onload = img.onerror = function () {
                    count++;
                    afterLoad(src, 'onload');

                    if (count === firstScreenImages.length) {
                        var now = new Date().getTime();
                        
                        // 倒序
                        firstScreenImagesDetail.sort(function (a, b) {
                            return b.responseEnd - a.responseEnd;
                        });

                        callback({
                            firstScreenTime: now - _global.forcedNavStartTimeStamp,
                            firstScreenTimeStamp: now + _global._originalNavStart,
                            firstScreenImagesDetail: firstScreenImagesDetail
                        });
                    }
                };
            }
        });

        if (shouldGetFromPerformance) {
            getFromPerformance();
        }
    }
};
