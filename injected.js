(function () {
  'use strict';

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalFetch = window.fetch;

  // ===== 1. 解析器注册 =====
  const PARSERS = [
    {
      name: "weibo",
      match: (url) =>
        typeof url === "string" &&
        url.includes("buildComments"),
      parse: parseWeiboComments
    },
    {
      name: "x",
      match: (url) =>
        typeof url === "string" &&
        url.includes("/graphql/") &&
        url.includes("TweetDetail"),
      parse: parseXComments
    },
    {
      name: "reddit",
      match: function(url) {
        return typeof url === "string" && url.includes("/comments/") && url.endsWith(".json");
      },
      parse: parseRedditComments
    }
  ];

  // ===== 2. XHR hook =====
  XMLHttpRequest.prototype.open = function (method, url) {
    this._url = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    const xhr = this;
    const url = xhr._url;
    
    // 只处理相关请求
    if (url && (url.includes("/comments/") || url.includes(".json") || 
                url.includes("buildComments") || url.includes("TweetDetail"))) {
      console.log("🟢 [XHR] Request sent:", url);
      
      xhr.addEventListener("load", function() {
        console.log("🟢 [XHR] Response:", url, "Status:", this.status);
        
        console.log("📋 [XHR] Response headers:", {
          url: url,
          contentType: this.getResponseHeader('content-type'),
          contentLength: this.getResponseHeader('content-length')
        });
        
        try {
          const parser = PARSERS.find(p => p.match(url));
          if (!parser) return;
          
          let json = null;
          
          if (this.response && typeof this.response === "object") {
            json = this.response;
            console.log("📦 [XHR] Response type: object", { url, keys: Object.keys(json) });
          } else {
            const text = this.responseText;
            console.log("📄 [XHR] Response text:", {
              url,
              length: text?.length || 0,
              isEmpty: !text || text.trim() === "",
              isHtml: text?.trim()?.startsWith("<"),
              preview: text?.slice(0, 200)
            });
            
            if (!text || text.trim() === "" || text.startsWith("<")) {
              console.warn("⚠️ [XHR] Skipped: empty response or HTML", { url });
              return;
            }
            try {
              json = JSON.parse(text);
              console.log("✅ [XHR] JSON parsed successfully", { url, keys: Object.keys(json) });
            } catch (e) {
              console.warn("❌ [XHR] Failed to parse JSON:", url, e.message);
              return;
            }
          }
          
          if (!json) {
            console.warn("⚠️ [XHR] JSON is empty", { url });
            return;
          }
          
          console.log("🔍 [XHR] Calling parser:", parser.name, { url });
          const result = parser.parse(json);
          console.log("📊 [XHR] Parser result:", {
            url,
            parserName: parser.name,
            hasResult: !!result,
            resultLength: result?.length || 0,
            resultPreview: result?.slice?.(0, 2)
          });
          
          if (result && result.length) {
            console.log(`✅ [XHR] Captured ${result.length} ${parser.name} comments`);
            window.postMessage({
              type: "COMMENTS_CAPTURED",
              platform: parser.name,
              data: result,
              source: "xhr"
            }, "*");
          } else {
            console.warn(`⚠️ [XHR] ${parser.name} returned no comments`, { url });
          }
        } catch (e) {
          console.error("❌ [XHR] Parser error:", { url, error: e.message, stack: e.stack });
        }
      });
    }
    
    return originalSend.apply(this, arguments);
  };

  // ===== 3. fetch hook =====
  window.fetch = async function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    
    console.log("🌐 [Fetch] Request:", {
      url: url,
      method: args[1]?.method || "GET",
      hasBody: !!args[1]?.body
    });
    
    const response = await originalFetch.apply(this, args);
    
    // 提前返回检查
    if (!url) return response;
    
    console.log("📡 [Fetch] Response:", {
      url: url,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type")
    });
    
    const parser = PARSERS.find(p => p.match(url));
    if (parser?.name === "x") {
      console.log("🧠 [Fetch] Matched X GraphQL:", url);
    }
    if (!parser) return response;
    
    if (!response.ok) {
      console.warn("⚠️ [Fetch] Abnormal response status:", { url, status: response.status });
      return response;
    }
    
    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      console.warn("⚠️ [Fetch] Non-JSON response:", { url, contentType });
      return response;
    }
    
    // 克隆响应读取内容
    const clone = response.clone();
    let text = "";
    try {
      text = await clone.text();
      console.log("📄 [Fetch] Response content:", {
        url,
        length: text.length,
        isEmpty: !text || text.trim() === "",
        isHtml: text.trim().startsWith("<"),
        preview: text.slice(0, 300)
      });
      
      if (!text || text.trim() === "" || text.trim().startsWith("<")) {
        console.warn("⚠️ [Fetch] Skipped: empty response or HTML", { url });
        return response;
      }
    } catch (e) {
      console.error("❌ [Fetch] Failed to read response:", { url, error: e.message });
      return response;
    }
    
    // 解析JSON
    let json;
    try {
      json = JSON.parse(text);
      console.log("✅ [Fetch] JSON parsed successfully", {
        url, 
        topKeys: Object.keys(json),
        hasData: !!json.data,
        hasErrors: !!json.errors
      });
      
      // 特别记录X平台的响应结构
      if (parser?.name === "x" && json.data) {
        console.log("🎯 [X Platform] Data structure:", {
          url,
          dataKeys: Object.keys(json.data),
          sample: JSON.stringify(json.data).slice(0, 500)
        });
      }
    } catch (e) {
      console.warn("❌ [Fetch] Failed to parse JSON:", { url, error: e.message });
      return response;
    }
    
    // 调用解析器
    console.log("🔍 [Fetch] Calling parser:", parser.name, { url });
    const result = parser.parse(json);
    console.log("📊 [Fetch] Parser result:", {
      url,
      parserName: parser.name,
      hasResult: !!result,
      resultLength: result?.length || 0,
      resultPreview: result?.slice?.(0, 2)
    });
    
    if (result && result.length) {
      console.log(`✅ [Fetch] Captured ${result.length} ${parser.name} comments`);
      window.postMessage({
        type: "COMMENTS_CAPTURED",
        platform: parser.name,
        data: result
      }, "*");
    } else {
      console.warn(`⚠️ [Fetch] ${parser.name} returned no comments`, { url });
    }
    
    return response;
  };

  // ===== 4. 微博 =====
  function parseWeiboComments(json) {
    const rootList = json.data || [];
    const flatList = [];

    rootList.forEach(root => {
      // 处理主评论
      flatList.push({
        id: String(root.id || ''),
        parent_id: '',
        user_id: String(root.user?.id || ''),
        text: root.text_raw || '',
        like_count: root.like_counts || 0,
        created_at: root.created_at || '',
      });

      // 处理子评论（回复）
      if (Array.isArray(root.comments)) {
        root.comments.forEach(sub => {
          flatList.push({
            id: String(sub.id || ''),
            parent_id: String((sub.rootid !== sub.id ? sub.rootid : root.id) || ''),
            user_id: String(sub.user?.id || ''),
            text: sub.text_raw || '',
            like_count: sub.like_counts || 0,
            created_at: sub.created_at || '',
          });
        });
      }
    });

    return flatList;
  }

  // ===== 5. X 平台 =====
  function parseXComments(json) 
  {
      const flatList = [];
      const seen = new Set(); 
      try {
        console.log('Start parsing X/Twitter data');
        
        // 时间戳转换函数：适配 X 平台格式 "%a %b %d %H:%M:%S %z %Y"，转换为 UTC+8
        function formatXTimestamp(timestamp) {
          if (!timestamp) return '';
          try {
            // X 平台格式示例: "Wed Jan 15 10:30:00 +0000 2024"
            // 解析时间字符串
            const match = timestamp.match(/^(\w{3}) (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4}) (\d{4})$/);
            
            if (match) {
              const [, month, day, hours, minutes, seconds, timezone, year] = match;
              
              // 月份转换
              const monthMap = {
                'Jan': '0', 'Feb': '1', 'Mar': '2', 'Apr': '3',
                'May': '4', 'Jun': '5', 'Jul': '6', 'Aug': '7',
                'Sep': '8', 'Oct': '9', 'Nov': '10', 'Dec': '11'
              };
              
              const monthIndex = monthMap[month];
              if (monthIndex === undefined) {
                console.warn('Unknown month:', month);
                return timestamp;
              }
              
              // 解析时区偏移（如 +0000 或 -0500）
              const timezoneOffset = parseInt(timezone, 10);
              const timezoneHours = Math.floor(timezoneOffset / 100);
              const timezoneMinutes = timezoneOffset % 100;
              
              // 创建 UTC 时间对象
              const utcDate = new Date(Date.UTC(
                parseInt(year, 10),
                parseInt(monthIndex, 10),
                parseInt(day, 10),
                parseInt(hours, 10),
                parseInt(minutes, 10),
                parseInt(seconds, 10)
              ));
              
              // 转换为 UTC+8（东八区，+8 小时）
              const targetTimezoneOffset = 8 * 60; // +8 小时 = 480 分钟
              const localDate = new Date(utcDate.getTime() + targetTimezoneOffset * 60 * 1000);
              
              // 格式化输出
              const y = localDate.getUTCFullYear();
              const m = String(localDate.getUTCMonth() + 1).padStart(2, '0');
              const d = String(localDate.getUTCDate()).padStart(2, '0');
              const h = String(localDate.getUTCHours()).padStart(2, '0');
              const min = String(localDate.getUTCMinutes()).padStart(2, '0');
              const sec = String(localDate.getUTCSeconds()).padStart(2, '0');
              
              return `${y}-${m}-${d} ${h}:${min}:${sec}`;
            }
            
            // 备用方案：使用 Date 对象解析
            const date = new Date(timestamp);
            if (!isNaN(date.getTime())) {
              // 转换为 UTC+8
              const utc8Date = new Date(date.getTime() + 8 * 60 * 60 * 1000);
              const year = utc8Date.getUTCFullYear();
              const month = String(utc8Date.getUTCMonth() + 1).padStart(2, '0');
              const day = String(utc8Date.getUTCDate()).padStart(2, '0');
              const hours = String(utc8Date.getUTCHours()).padStart(2, '0');
              const minutes = String(utc8Date.getUTCMinutes()).padStart(2, '0');
              const seconds = String(utc8Date.getUTCSeconds()).padStart(2, '0');
              return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
            }
            
            console.warn('Unable to parse timestamp format:', timestamp);
            return timestamp;
            
          } catch (error) {
            console.error('Failed to convert timestamp format:', error);
            return timestamp;
          }
        }
        
        // 递归提取推文的通用函数
        function extractTweet(tweet, parentId = '') {
          if (!tweet || !tweet.legacy) return;
          
          // 跳过已删除的推文
          if (tweet.legacy.full_text === '[deleted]' || !tweet.legacy.user_id_str) {
            return;
          }
          
          const id = String(tweet.rest_id || '');
          if (!id || seen.has(id)) return;
          
          seen.add(id);
          
          flatList.push({
            id: id,
            parent_id: tweet.legacy.in_reply_to_status_id_str ? String(tweet.legacy.in_reply_to_status_id_str) : parentId,
            user_id: String(tweet.legacy.user_id_str || ''),
            text: tweet.legacy.full_text || '',
            like_count: tweet.legacy.favorite_count || 0,
            created_at: formatXTimestamp(tweet.legacy.created_at)
          });
          
          return id; // 返回当前ID，用于设置子评论的parent_id
        }
        
        // 主解析：TweetDetail 对话线程
        const instructions =
          json?.data?.threaded_conversation_with_injections_v2?.instructions || [];
        
        console.log(`Found ${instructions.length} instruction block(s)`);
        
        for (const ins of instructions) {
          if (!ins.entries) continue;
          
          for (const entry of ins.entries) {
            // 情况1：直接包含推文
            let tweet = entry?.content?.itemContent?.tweet_results?.result;
            if (tweet) {
              extractTweet(tweet);
            }
            
            // 情况2：包含 items 数组（回复列表）
            const items = entry?.content?.items || [];
            if (items.length > 0) {
              console.log(`Found items array with length: ${items.length}`);
              for (const item of items) {
                // 处理 item 下的推文
                let itemTweet = item?.item?.itemContent?.tweet_results?.result;
                if (itemTweet) {
                  extractTweet(itemTweet);
                }
                
                // 处理 item 下的嵌套 items（更深层的回复）
                const subItems = item?.items || [];
                if (subItems.length > 0) {
                  console.log(`Found nested items with length: ${subItems.length}`);
                  for (const subItem of subItems) {
                    const subTweet = subItem?.item?.itemContent?.tweet_results?.result;
                    if (subTweet) {
                      extractTweet(subTweet);
                    }
                  }
                }
              }
            }
            
            // 情况3：包含 timeline 结构
            const timeline = entry?.content?.timeline;
            if (timeline?.instructions) {
              for (const timelineIns of timeline.instructions) {
                if (timelineIns.entries) {
                  for (const timelineEntry of timelineIns.entries) {
                    const timelineTweet = timelineEntry?.content?.itemContent?.tweet_results?.result;
                    if (timelineTweet) {
                      extractTweet(timelineTweet);
                    }
                  }
                }
              }
            }
          }
        }

        // ===== 备用：home_timeline / timeline 分页数据 =====
        const timelineInstructions =
          json?.data?.home?.home_timeline_urt?.instructions ||
          json?.data?.timeline?.instructions ||
          [];

        for (const ins of timelineInstructions) {
          if (!ins.entries) continue;

          for (const entry of ins.entries) {
            let tweet = entry?.content?.itemContent?.tweet_results?.result;
            if (tweet) {
              extractTweet(tweet);
            }
            
            // 处理 items 数组
            const items = entry?.content?.items || [];
            for (const item of items) {
              const itemTweet = item?.item?.itemContent?.tweet_results?.result;
              if (itemTweet) {
                extractTweet(itemTweet);
              }
            }
          }
        }
        
        console.log(`✅ Successfully extracted ${flatList.length} comments`);
        
      } catch (error) {
        console.error('Parsing failed:', error);
      }
      
      return flatList;
  }

    // ===== 6. Reddit =====
  function parseRedditComments(json) {
    const flatList = [];
    
    try {
      console.log('Start parsing Reddit data');
      
      // 时间戳转换函数：Unix时间戳转字符串格式
      function formatTimestamp(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const weekday = weekdays[date.getUTCDay()];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[date.getUTCMonth()];
        const day = String(date.getUTCDate()).padStart(2, ' ');
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        const timezoneOffset = '+0800';
        const year = date.getUTCFullYear();

        return `${weekday} ${month} ${day} ${hours}:${minutes}:${seconds} ${timezoneOffset} ${year}`;
      }
      
      // 标准 Reddit JSON API 格式
      if (Array.isArray(json) && json.length >= 2) {
        const commentListing = json[1];
        
        if (commentListing && commentListing.kind === 'Listing' && commentListing.data && commentListing.data.children) {
          console.log(`Found ${commentListing.data.children.length} top-level item(s)`);
          
          function extractComments(children, parentId = null, depth = 0) {
            for (const child of children) {
              // t1 代表评论
              if (child.kind === 't1' && child.data) {
                const comment = child.data;
                
                // 跳过已删除的评论
                if (comment.body === '[deleted]' || comment.author === '[deleted]') {
                  continue;
                }
                let realParentId = '';

                if (comment.parent_id) {
                  const pid = comment.parent_id;
                
                  if (pid.startsWith('t1_')) {
                    realParentId = pid.replace('t1_', '');
                  } else {
                    realParentId = '';
                  }
                } else if (parentId) {
                  realParentId = String(parentId);
                }
                
                flatList.push({
                  id: String(comment.id || ''),
                  parent_id: realParentId,
                  user_id: String(comment.author || ''),
                  text: comment.body || '',
                  like_count: comment.score || 0,
                  created_at: formatTimestamp(comment.created_utc)
                });
                
                // 处理嵌套回复
                if (comment.replies && comment.replies.data && comment.replies.data.children) {
                  extractComments(comment.replies.data.children, comment.id, depth + 1);
                }
              }
            }
          }
          
          extractComments(commentListing.data.children);
          console.log(`✅ Successfully extracted ${flatList.length} comments`);
        }
      } else {
        console.log('Data format is not the standard Reddit API format');
      }
      
    } catch (error) {
      console.error('Parsing failed:', error);
    }
    
    return flatList;
  }


  async function fetchRedditComments() {
    const path = window.location.pathname;
    const match = path.match(/\/comments\/([a-z0-9]+)\//);
    
    if (!match) {
      console.log('[Active Fetch] Current page is not a Reddit post page');
      return;
    }
    
    const postId = match[1];
    const subreddit = path.split('/')[2];
    const apiUrl = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json`;
    
    // 避免短时间内重复请求
    if (window._lastRedditFetch === apiUrl && Date.now() - window._lastRedditTime < 3000) {
      console.log('[Active Fetch] Skipped duplicate request:', apiUrl);
      return;
    }
    window._lastRedditFetch = apiUrl;
    window._lastRedditTime = Date.now();
    
    console.log('[Active Fetch] Requesting Reddit API:', apiUrl);
    
    try {
      const response = await fetch(apiUrl);
      const data = await response.json();
      
      const parser = PARSERS.find(p => p.match(apiUrl));
      if (parser) {
        const result = parser.parse(data);
        if (result && result.length) {
          console.log(`✅ [Active Fetch] Captured ${result.length} Reddit comments`);
          window.postMessage({
            type: "COMMENTS_CAPTURED",
            platform: parser.name,
            data: result,
            source: "active"
          }, "*");
        } else {
          console.log('[Active Fetch] No comments parsed');
        }
      }
    } catch (error) {
      console.error('[Active Fetch] Fetch failed:', error);
    }
  }
    
  // 页面加载完成后执行主动获取
  function initActiveFetch() {
    // 如果是 Reddit 页面，立即获取
    if (window.location.hostname.includes('reddit.com')) {
      console.log('[Active Fetch] Initializing Reddit active fetch');
      setTimeout(fetchRedditComments, 500);
    }
  }
  
  // 监听页面加载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initActiveFetch);
  } else {
    initActiveFetch();
  }
  
  // 监听 SPA 路由变化
  let lastUrl = location.href;
  const routeObserver = new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      if (currentUrl.includes('/comments/') && currentUrl.includes('reddit.com')) {
        console.log('[Active Fetch] Route change detected, fetching again');
        setTimeout(fetchRedditComments, 1000);
      }
    }
  });
    
  // 等待 body 存在后开始监听
  if (document.body) {
    routeObserver.observe(document.body, { subtree: true, childList: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      routeObserver.observe(document.body, { subtree: true, childList: true });
    });
  }
  
  // 监听浏览器前进/后退
  window.addEventListener('popstate', () => {
    if (location.href.includes('/comments/') && location.href.includes('reddit.com')) {
      console.log('[Active Fetch] Popstate detected, fetching again');
      setTimeout(fetchRedditComments, 500);
    }
  });
  
  console.log('✅ All interceptors injected; active fetch fallback enabled');

  function initRedditCommentObserver() {
    // 用于去重，避免重复发送同一条评论
    const processedIds = new Set();

      function formatTimestamp(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const weekday = weekdays[date.getUTCDay()];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[date.getUTCMonth()];
        const day = String(date.getUTCDate()).padStart(2, ' ');
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        const timezoneOffset = '+0800';
        const year = date.getUTCFullYear();

        return `${weekday} ${month} ${day} ${hours}:${minutes}:${seconds} ${timezoneOffset} ${year}`;
      }
    
    // 解析单个评论元素
    function parseCommentElement(el) {
      const id = el.getAttribute('thingId')?.replace('t1_', '');
      if (!id || processedIds.has(id)) return null;
      
      // 提取评论正文（从 slot="comment" 中获取）
      let text = '';
      const contentSlot = el.querySelector('[slot="comment"]');
      if (contentSlot) {
        text = contentSlot.textContent?.trim() || '';
      }
      // 如果没有 slot，尝试直接获取文本
      if (!text) {
        text = el.textContent?.trim() || '';
      }
      
      // 跳过已删除的评论
      if (!text || text === '[deleted]' || text === '[removed]' || text.includes('另外') || text.includes('更多回复')) {
        return null;
      }
      
      const author = el.getAttribute('author');
      const parentId = el.getAttribute('parentId')?.replace('t1_', '');
      const score = parseInt(el.getAttribute('score') || '0');
      const created = el.getAttribute('created');
      
      processedIds.add(id);

      let createdTimestamp = 0;

      if (created) {
        try {
          const t = new Date(created).getTime();
          if (!isNaN(t)) {
            createdTimestamp = Math.floor(t / 1000);
          } else {
            createdTimestamp = Math.floor(Date.now() / 1000);
          }
        } catch (e) {
          createdTimestamp = Math.floor(Date.now() / 1000);
        }
      }
      
      return {
        id: String(id || ''),
      
        parent_id: parentId ? String(parentId) : '',
      
        user_id: author ? String(author) : '',
      
        text: text || '',
      
        like_count: Number.isFinite(score) ? score : 0,
      
        created_at: formatTimestamp(createdTimestamp)
      };
    }
    
    // 递归查找所有评论元素
    function extractCommentsFromNode(node) {
      const comments = [];
      
      // 检查当前节点是否是评论元素
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'SHREDDIT-COMMENT') {
          const comment = parseCommentElement(node);
          if (comment) comments.push(comment);
        }
        
        // 递归查找子元素中的评论
        node.querySelectorAll?.('shreddit-comment').forEach(el => {
          const comment = parseCommentElement(el);
          if (comment) comments.push(comment);
        });
      }
      
      return comments;
    }
    
    // 创建 MutationObserver 监听 DOM 变化
    const observer = new MutationObserver((mutations) => {
      const newComments = [];
      
      for (const mutation of mutations) {
        // 检查新增的节点
        for (const node of mutation.addedNodes) {
          const comments = extractCommentsFromNode(node);
          newComments.push(...comments);
        }
      }
      
      // 发送新捕获的评论
      if (newComments.length > 0) {
        console.log(`🟢 [Reddit DOM] Captured ${newComments.length} new comments`);
        
        window.postMessage({
          type: "COMMENTS_CAPTURED",
          platform: "reddit",
          data: newComments,
          source: "dom-observer"
        }, "*");
      }
    });
    
    // 开始监听整个页面
    observer.observe(document.body, {
      childList: true,      // 监听子节点添加/删除
      subtree: true         // 监听所有后代节点
    });
    
    console.log('✅ Reddit comment DOM observer started for click-loaded comments');
    
    return observer;
  }

  function startRedditObserver() {
    if (document.body) {
      initRedditCommentObserver();
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        initRedditCommentObserver();
      });
    }
  }
  
  startRedditObserver();
})();

(function () {
  function safeInit() {
    if (document.readyState === 'loading' || !document.body) {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
      return;
    }
    init();
  }
  safeInit();
  function init()
  {
  const panel = document.createElement("div");
  panel.style.cssText = `
    position: fixed;
    bottom: 0;
    right: 0;
    width: 480px;
    height: 88%;
    background: var(--color-bg);
    border-top: 2px solid var(--color-border);
    border-right: 2px solid var(--color-border);
    box-shadow: -4px 0 0 0 oklch(80% 0.01 270);
    display: none;
    flex-direction: column;
    z-index: 999998;
    overflow: hidden;
    border-radius: 8px;
  `;
  document.body.appendChild(panel);

  let dragClassAdded = false;
  function makeDraggable(el) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let moved = false;

    const rect = el.getBoundingClientRect();
    el.style.left = rect.left + 'px';
    el.style.top = rect.top + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';

    const onDown = (e) => {
        if (e.target.closest('input, button, label, .toggle-icon')) return;
        isDragging = true;
        moved = false;
        el.classList.add('dragging-panel');
        dragClassAdded = true;
        const point = e.touches ? e.touches[0] : e;
        startX = point.clientX;
        startY = point.clientY;
        const r = el.getBoundingClientRect();
        startLeft = r.left;
        startTop = r.top;
        document.body.style.userSelect = 'none';
        e.preventDefault();
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const point = e.touches ? e.touches[0] : e;
        const dx = point.clientX - startX;
        const dy = point.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        let newLeft = startLeft + dx;
        let newTop = startTop + dy;
        const maxLeft = window.innerWidth - el.offsetWidth;
        const maxTop = window.innerHeight - el.offsetHeight;
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));
        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';
    };

    const onUp = () => {
        isDragging = false;
        document.body.style.userSelect = '';
        if (dragClassAdded) {
          el.classList.remove('dragging-panel');
          dragClassAdded = false;
        }
    };

    el.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    el.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }

  // Shared plugin logo used by the floating button and the panel header.
  const PLUGIN_LOGO_SVG = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12Z" stroke="currentColor" stroke-width="1.8" fill="none"/>
      <path d="M12 6C15.31 6 18 8.69 18 12C18 15.31 15.31 18 12 18C8.69 18 6 15.31 6 12C6 8.69 8.69 6 12 6Z" stroke="currentColor" stroke-width="1.8" fill="none" opacity="0.35"/>
      <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/>
    </svg>
  `;
  const ICON_HISTORY_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
      <path d="M12 7V12L15.5 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

  const ICON_DOWNLOAD_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4V15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M5 20H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

  const ICON_TRASH_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 7H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M10 11V17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M14 11V17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M8 7L9 4H15L16 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M7 7L8 20H16L17 7" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>
  `;

  const ICON_CHART_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 19V11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M12 19V5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M19 19V8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
  const ICON_COPY_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="8" width="10" height="10" rx="2" stroke="currentColor" stroke-width="2"/>
      <path d="M6 16H5C3.9 16 3 15.1 3 14V5C3 3.9 3.9 3 5 3H14C15.1 3 16 3.9 16 5V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

  const header = document.createElement("div");
  header.style.cssText = `
  padding:16px 20px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  background: var(--color-bg);
  border-bottom: 2px solid var(--color-border);
  position: relative;
  transition: background 0.15s ease-out;
  border-radius: 8px 8px 0 0;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
`;
  header.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <span class="panel-logo" aria-hidden="true" style="
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid var(--color-border);
        background: var(--color-bg);
        color: var(--color-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      ">
        ${PLUGIN_LOGO_SVG}
      </span>

      <span style="font-weight:600; font-size:15px; color:var(--color-text);">
        Comments Analyzer
      </span>
    </div>

    <button class="panel-close-button" type="button" aria-label="Close panel" title="Close panel" style="
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      padding: 6px;
      border-radius: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease-out;
      transform-origin: center;
    ">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z" stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="square" stroke-linejoin="square"/>
      </svg>
    </button>
  `;
  panel.appendChild(header);


  const content = document.createElement("div");
  content.style.cssText = `
    flex:1;
    overflow-y:auto;
    padding:20px;
    font-size:14px;
    line-height:1.7;
    color: var(--color-text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    scroll-behavior: smooth;
    border-radius: 0 0 8px 8px;
    font-size: 14.5px;
    line-height: 1.6;
  `;
  panel.appendChild(content);


  function collapsePanel() {
    // Hide the panel without clearing its current content.
    panel.style.display = 'none';

    if (typeof collapseButtonGroup === "function") {
      collapseButtonGroup();
    }
  }

  const closeButton = header.querySelector('.panel-close-button');
  if (closeButton) {
    closeButton.onclick = collapsePanel;
  }

  let panelDraggable = false;   // 标记是否已经启用拖拽

  function openPanel() {
      panel.style.display = 'flex';
      panel.style.right = '0';
      panel.style.bottom = '0';
      panel.style.left = 'auto';
      panel.style.top = 'auto';
      panel.style.opacity = "1";

      if (!panelDraggable) {
          setTimeout(() => {
              makeDraggable(panel);
              panelDraggable = true;
          }, 50);
      }
  }


  function showLoading() {
    content.innerHTML = `
      <div style="
        display:flex;
        justify-content:center;
        align-items:center;
        height:100%;
        flex-direction:column;
        gap:16px;
        color:var(--color-text-muted);
        font-size:13px;
      ">
        <div class="spinner" aria-hidden="true"></div>
        <span>Analyzing comments...</span>
      </div>
    `;
  }


  const style = document.createElement("style");
  style.innerHTML = `
    :root {
      --color-primary: oklch(62% 0.20 255);
      --color-primary-dark: oklch(52% 0.22 255);
      --color-primary-light: oklch(90% 0.07 255);
      --color-text: oklch(15% 0.01 270);
      --color-text-muted: oklch(40% 0.015 270);
      --color-text-light: oklch(55% 0.012 270);
      --color-border: oklch(78% 0.025 270);
      --color-border-light: oklch(88% 0.015 270);
      --color-bg: oklch(99% 0.002 270);
      --color-bg-hover: oklch(95% 0.008 270);
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02);
      --shadow-md: 0 2px 4px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.02);
      --shadow-lg: 0 4px 8px rgba(0,0,0,0.08);
      --shadow-lift: 0 4px 12px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.03);
      --shadow-elevated: 0 8px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04);
      --glow-primary: 0 0 0 2px oklch(62% 0.20 255 / 0.28);
      --color-accent: oklch(55% 0.14 230);
      --color-accent-hover: oklch(62% 0.16 230);
      --color-success: oklch(50% 0.14 145);
      --color-warning: oklch(55% 0.14 80);
      --color-error: oklch(50% 0.16 10);
      --transition-fast: all 0.15s ease-out-quart;
      --transition-normal: all 0.2s ease-out-quart;
      --transition-slow: all 0.3s ease-out-quart;
    }

    /* 滚动条样式 */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    ::-webkit-scrollbar-track {
      background: oklch(92% 0.008 270);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb {
      background: oklch(72% 0.03 270);
      border-radius: 4px;
      border: 1px solid var(--color-border-light);
      transition: background 0.2s ease-out;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: oklch(65% 0.04 270);
    }

    ::-webkit-scrollbar-corner {
      background: oklch(92% 0.008 270);
    }

    .dragging-panel {
      box-shadow: var(--shadow-elevated);
      transition: box-shadow 0.15s ease-out !important;
      cursor: grabbing !important;
    }

    .dragging-panel:hover {
      box-shadow: -6px -6px 16px rgba(0, 0, 0, 0.15), 6px 6px 16px rgba(0, 0, 0, 0.1) !important;
    }

    .spinner {
      width: 28px;
      height: 28px;
      border: 2px solid oklch(78% 0.05 265);
      border-top: 2px solid var(--color-primary);
      border-right-color: var(--color-primary);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    /* Focus styles for accessibility */
    button:focus-visible,
    .analysis-title:focus-within,
    input:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }

    /* Keyboard navigation feedback */
    .analysis-section:focus-within {
      box-shadow: var(--glow-primary);
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes pulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }

    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .analysis-section {
      margin-bottom: 18px;
      background: var(--color-bg);
      border-radius: 8px;
      box-shadow: var(--shadow-sm);
      border: 2px solid var(--color-border);
      overflow: hidden;
      transition: var(--transition-normal);
      animation: fadeIn 0.3s ease-out;
    }

    .analysis-section:focus-within {
      box-shadow: var(--glow-primary);
    }

    .analysis-section:hover {
      border-color: var(--color-primary);
      box-shadow: var(--shadow-lift);
    }

    .analysis-section:active {
      transform: scale(0.995);
      border-color: var(--color-primary-dark);
    }

    .analysis-title {
      padding: 14px 16px;
      font-weight: 600;
      font-size: 15px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--color-text);
      background: var(--color-bg);
      transition: var(--transition-fast);
      border-radius: 8px 8px 0 0;
      border-bottom: 1px solid var(--color-border-light);
      letter-spacing: 0.02em;
    }

    .analysis-title:hover {
      background: var(--color-bg-hover);
    }

    .analysis-title:focus-within {
      box-shadow: inset 0 0 0 2px var(--color-primary);
    }

    .analysis-body {
      padding: 0 24px;
      font-size: 13.5px;
      color: var(--color-text);
      background: var(--color-bg);
      display: none;
      line-height: 1.7;
      border-radius: 0 0 4px 4px;
      transition: padding 0.2s ease-out;
    }

    .analysis-body.expanded {
      padding: 24px;
      border-top: 2px solid var(--color-border-light);
    }

    pre {
      background: oklch(95% 0.006 270);
      padding: 14px;
      border-radius: 0;
      overflow: auto;
      font-size: 12.5px;
      line-height: 1.6;
      color: oklch(30% 0.012 270);
      font-family: 'SF Mono', 'Consolas', 'Monaco', 'Courier New', monospace;
      box-shadow: inset 0 0 0 1px oklch(80% 0.02 270);
      transition: box-shadow 0.2s ease-out;
    }

    pre:hover {
      box-shadow: inset 0 0 0 1px var(--color-primary);
    }

    code {
      background: oklch(90% 0.025 265);
      padding: 1.5px 5px;
      border-radius: 0;
      font-family: inherit;
      color: var(--color-primary);
      font-size: 0.9em;
    }

    pre code {
      background: none;
      padding: 0;
      color: inherit;
    }

    /* 评论块的动画效果 */
    .comment-block {
      animation: fadeIn 0.2s ease-out;
      transition: var(--transition-fast);
    }

    .comment-block:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-lift);
    }

    /* 搜索结果动画 */
    #search-results {
      transition: opacity 0.2s ease-out;
      font-size: 12px;
      color: var(--color-text-muted);
      text-align: right;
      padding-right: 8px;
      min-height: 16px;
    }

    /* ===== Buttons ===== */
    .btn-base {
      padding: 9px 18px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: var(--transition-fast);
      transform-origin: center;
      min-width: 70px;
      font-family: inherit;
    }
    .btn-base:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
    .btn-action {
      border: none;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);  /* 轻微阴影代替边框 */
    }
    .btn-action:hover {
      background: oklch(88% 0.08 255);     /* 悬停时背景稍深一点 */
      color: #000000;                       /* 悬停时字体黑色（或深灰色） */
      border-color: oklch(65% 0.12 265);    /* 悬停时边框稍明显 */
      transform: translateY(-1px);
      box-shadow: var(--shadow-lift);
    }
    .btn-action:active {
      transform: scale(0.95);
      box-shadow: none;
    }
  `;
  document.head.appendChild(style);

/**
 * 从混合文本中提取第一个完整的 JSON 对象或数组字符串
 * @param {string} text - 原始文本
 * @returns {string|null} 提取的 JSON 字符串，若无效则返回 null
 */
  function extractFirstJSON(text) {
    if (!text || typeof text !== 'string') return null;

    let startIndex = -1;
    let stackType = null; // 'object' or 'array'

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') {
            startIndex = i;
            stackType = 'object';
            break;
        }
        if (ch === '[') {
            startIndex = i;
            stackType = 'array';
            break;
        }
    }

    if (startIndex === -1) return null;

    let stack = 1; // 从 1 开始，因为已经找到了起始字符
    let inString = false;
    let escape = false;
    let endIndex = -1;

    for (let i = startIndex + 1; i < text.length; i++) { // 从起始位置的下一个字符开始
        const ch = text[i];

        if (escape) {
            escape = false;
            continue;
        }

        if (ch === '\\') {
            escape = true;
            continue;
        }

        if (ch === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        // 根据栈类型处理括号匹配
        if (stackType === 'object') {
            if (ch === '{') {
                stack++;
            } else if (ch === '}') {
                stack--;
                if (stack === 0) {
                    endIndex = i;
                    break;
                }
            }
        } else { // array
            if (ch === '[') {
                stack++;
            } else if (ch === ']') {
                stack--;
                if (stack === 0) {
                    endIndex = i;
                    break;
                }
            }
        }
    }

    if (endIndex === -1) return null;

    const candidate = text.substring(startIndex, endIndex + 1);

    try {
        JSON.parse(candidate);
        return candidate;
    } catch (e) {
        // 如果解析失败，尝试提取更深层的 JSON
        const subText = text.substring(startIndex + 1, endIndex);
        const innerJSON = extractFirstJSON(subText);
        return innerJSON;
    }
  }

  function normalizeContent(input) {
    // 处理字符串：去除 <think> 标签和 JSON 代码块标记
    let processedInput = input;
    if (typeof input === "string") {
        // 去除 <think>...</think> 标签及其内容
        processedInput = processedInput.replace(/<think>[\s\S]*?<\/think>/g, '');

        // 去除 ```json 和 ``` 代码块标记，提取其中的JSON内容
        const codeBlockMatch = processedInput.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
            // 如果找到代码块，使用代码块内的内容
            processedInput = codeBlockMatch[1].trim();
        } else {
            // 没有代码块时，尝试从文本中提取第一个完整的 JSON 对象或数组
            const extractedJSON = extractFirstJSON(processedInput);
            if (extractedJSON) {
                processedInput = extractedJSON;
            }
        }
        processedInput = processedInput.trim();
    }

    // 检测是否是对象或类JSON结构
    let obj = null;
    let isStructured = false;

    // 情况1：输入是对象
    if (typeof processedInput === "object" && processedInput !== null) {
        obj = processedInput;
        isStructured = true;
    }
    // 情况2：输入是字符串，可能包含JSON结构
    else if (typeof processedInput === "string") {
        const trimmed = processedInput.trim();
        // 检测是否以 { 或 [ 开头并以 } 或 ] 结尾
        if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
            try {
                obj = JSON.parse(trimmed);
                isStructured = true;
            } catch (e) {
                // 解析失败，不作为结构化数据处理
                // 尝试修复常见的 JSON 问题
                const fixed = tryFixJSON(trimmed);
                if (fixed) {
                    try {
                        obj = JSON.parse(fixed);
                        isStructured = true;
                        processedInput = fixed;
                    } catch (e2) {
                        // 仍然失败
                    }
                }
            }
        }
    }

    // 如果是结构化数据，转换为友好的Markdown格式
    if (isStructured && obj) {
        return convertToFriendlyMarkdown(obj);
    }

    // 普通字符串处理：尝试解析JSON或作为普通文本处理
    if (typeof processedInput === "string") {
        try {
            const parsed = JSON.parse(processedInput);
            return convertToFriendlyMarkdown(parsed);
        } catch {
            return formatPlainText(processedInput);
        }
    }

    return String(processedInput);
  }

  function tryFixJSON(jsonStr) {
    if (!jsonStr) return null;

    let fixed = jsonStr;

    // 修复未转义的引号（简单场景）
    fixed = fixed.replace(/(?<!\\)"([^"\\]*?)"/g, (match, content) => {
        // 如果内容包含未转义的双引号，进行转义
        return '"' + content.replace(/"/g, '\\"') + '"';
    });

    // 修复末尾多余逗号
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

    // 修复缺失的引号（简单场景）
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');

    // 修复单引号
    fixed = fixed.replace(/'/g, '"');

    // 检查是否还有未闭合的括号
    let braceCount = 0;
    let bracketCount = 0;
    for (let i = 0; i < fixed.length; i++) {
        if (fixed[i] === '{') braceCount++;
        if (fixed[i] === '}') braceCount--;
        if (fixed[i] === '[') bracketCount++;
        if (fixed[i] === ']') bracketCount--;
    }

    // 补充缺失的闭合括号
    while (braceCount > 0) {
        fixed += '}';
        braceCount--;
    }
    while (bracketCount > 0) {
        fixed += ']';
        bracketCount--;
    }

    try {
        JSON.parse(fixed);
        return fixed;
    } catch (e) {
        return null;
    }
  }

  /**
   * 将JSON数据转换为友好的Markdown格式
   * @param {any} data - 待转换的数据
   * @param {number} level - 层级深度
   * @returns {string} Markdown格式的字符串
   */
  function convertToFriendlyMarkdown(data, level = 0) {
    if (data === null) return `<em>No data available</em>`;
    if (data === undefined) return `<em>Undefined</em>`;

    // 处理基本类型
    if (typeof data !== "object") {
      return formatValueWithStyle(data);
    }

    const isArray = Array.isArray(data);

    // 处理空数组/对象
    if ((isArray && data.length === 0) || (!isArray && Object.keys(data).length === 0)) {
      return isArray ? `<em>Empty array</em>` : `<em>Empty object</em>`;
    }

    let markdown = '';

    if (isArray) {
      // 数组展示为列表
      markdown += `\n`;
      data.forEach((item, index) => {
        const formattedItem = convertToFriendlyMarkdown(item, level + 1);
        // 判断是否为复杂类型
        if (typeof item === 'object' && item !== null) {
          markdown += `<div style="margin: 8px 0; padding: 8px; background: oklch(96% 0.015 265); border: 1px solid var(--color-primary); border-radius: 0;">\n`;
          markdown += `<strong>${index + 1}.</strong>\n`;
          markdown += `${formattedItem}\n`;
          markdown += `</div>\n`;
        } else {
          markdown += `<div style="margin: 4px 0;">\n`;
          markdown += `  <span style="display: inline-block; width: 24px; color: var(--color-primary); font-weight: 500;">${index + 1}.</span> ${formattedItem}\n`;
          markdown += `</div>\n`;
        }
      });
    } else {
      // 对象展示为卡片式布局
      markdown += `\n`;
      const entries = Object.entries(data);

      for (const [key, value] of entries) {
        const formattedKey = formatKeyToTitle(key);
        const formattedValue = convertToFriendlyMarkdown(value, level + 1);

        // 根据值的类型决定展示方式
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // 嵌套对象，使用折叠面板样式
          const detailsId = 'd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
          markdown += `<details open id="${detailsId}" style="margin: 8px 0; padding: 8px; background: oklch(96% 0.015 265); border-radius: 0;">\n`;
          markdown += `<summary style="font-weight: 600; color: var(--color-text); cursor: pointer;">${formattedKey}</summary>\n`;
          markdown += `<div style="margin-top: 8px; padding-left: 16px;">\n`;
          markdown += `${formattedValue}\n`;
          markdown += `</div>\n`;
          markdown += `</details>\n`;
        } else if (Array.isArray(value)) {
          // 数组，使用卡片样式
          markdown += `<div style="margin: 8px 0; padding: 8px; background: oklch(96% 0.015 265); border-radius: 0;">\n`;
          markdown += `<div style="font-weight: 600; color: var(--color-text); margin-bottom: 8px;">📋 ${formattedKey}</div>\n`;
          markdown += `<div style="padding-left: 16px;">\n`;
          markdown += `${formattedValue}\n`;
          markdown += `</div>\n`;
          markdown += `</div>\n`;
        } else {
          // 简单值，使用标签样式
          markdown += `<div style="margin: 6px 0; display: flex; align-items: baseline;">\n`;
          markdown += `  <span style="min-width: 100px; font-weight: 500; color: var(--color-text-muted);">${formattedKey}</span>\n`;
          markdown += `  <span style="color: var(--color-text);">${formattedValue}</span>\n`;
          markdown += `</div>\n`;
        }
      }
    }

    return markdown;
  }

  /**
   * 格式化值，添加渲染样式
   * @param {any} value - 需要格式化的值
   * @returns {string} 带HTML样式的字符串
   */
  function formatValueWithStyle(value) {
    const type = typeof value;
    switch (type) {
      case 'string':
        // 如果是 URL 或邮箱，特殊处理
        if (value.match(/^https?:\/\//)) {
          return `<a href="${escapeHtml(value)}" style="color: var(--color-primary); text-decoration: none; border-bottom: 1px solid var(--color-primary);" target="_blank">${escapeHtml(value)}</a>`;
        }
        if (value.match(/^[\w.-]+@[\w.-]+\.\w+$/)) {
          return `<a href="mailto:${escapeHtml(value)}" style="color: var(--color-primary); text-decoration: none;">${escapeHtml(value)}</a>`;
        }
        return `<span style="color: var(--color-primary); background: oklch(94% 0.03 265); padding: 2px 7px; border-radius: 2px; font-family: monospace; border: 1px solid oklch(78% 0.08 265);">${renderBasicMarkdown(escapeHtml(value))}</span>`;
      case 'number':
        return `<span style="color: oklch(25% 0.1 265); font-weight: 500; background: oklch(90% 0.04 265); padding: 2px 7px; border-radius: 2px;">${value}</span>`;
      case 'boolean':
        return value
          ? `<span style="color: oklch(30% 0.1 145); font-weight: 500; background: oklch(90% 0.05 145); padding: 2px 7px; border-radius: 2px;">✅ yes</span>`
          : `<span style="color: oklch(40% 0.14 10); font-weight: 500; background: oklch(92% 0.04 10); padding: 2px 7px; border-radius: 2px;">❌ no</span>`;
      default:
        return `<span style="color: oklch(40% 0.02 270); font-family: monospace;">${escapeHtml(String(value))}</span>`;
    }
  }

  /**
   * 将键名格式化为标题风格
   * @param {string} key - 原始键名
   * @returns {string} 格式化后的标题
   */
  function formatKeyToTitle(key) {
    const chineseMap = {
      'name': 'Name'
    };

    // 如果有映射，直接返回
    if (chineseMap[key.toLowerCase()]) {
      return chineseMap[key.toLowerCase()];
    }

    // 将驼峰命名转换为空格分隔
    const withSpaces = key.replace(/([A-Z])/g, ' $1');
    // 将下划线转换为空格
    const withSpaces2 = withSpaces.replace(/_/g, ' ');
    // 首字母大写
    let result = withSpaces2.charAt(0).toUpperCase() + withSpaces2.slice(1).trim();

    return result;
  }

  /**
   * Converts basic markdown to HTML (bold, italic, inline code).
   * Call after escapeHtml — the markdown syntax chars (*, `) survive escaping.
   */
  function renderBasicMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    // Bold: **text**
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic: *text*
    text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Inline code: `text`
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    return text;
  }

  /**
   * 格式化纯文本，支持基本渲染
   * @param {string} text - 需要格式化的文本
   * @returns {string} 格式化后的HTML
   */
  function formatPlainText(text) {
    if (!text || text.trim() === '') return '';

    // 简单的文本格式化，保留换行
    let html = escapeHtml(text);
    html = renderBasicMarkdown(html);
    html = html.replace(/\n/g, '<br>');

    return `<div style="line-height: 1.6; color: var(--color-text);">${html}</div>`;
  }

  /**
   * HTML转义函数
   * @param {string} str - 需要转义的字符串
   * @returns {string} 转义后的字符串
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }





  // 导出评论功能
// Export all captured comments by default because the UI now uses one unified comment pool.
  function exportComments() {
    const allComments = window.myPluginData?._fullComments || {};
    const blockIds = Object.keys(allComments);

    if (blockIds.length === 0) {
      alert('No comment data available for export. Please wait for comments to be captured first.');
      return;
    }

    const exportData = [];

    blockIds.forEach(blockIdStr => {
      const blockId = Number(blockIdStr);
      const comments = allComments[blockIdStr] || [];
      if (!Array.isArray(comments) || comments.length === 0) return;

      exportData.push({
        id: blockId,
        exportTime: new Date().toISOString(),
        commentCount: comments.length,
        comments: comments.map(c => ({
          id: c.id,
          author: c.user_id,
          text: c.text,
          likes: c.like_count,
          createdAt: c.created_at,
          parentId: c.parent_id || null
        }))
      });
    });

    if (exportData.length === 0) {
      alert('No captured comments found. Try reloading the page or waiting for comments to load.');
      return;
    }

    const jsonData = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'comments-export-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert('Exported ' + exportData.reduce((s, b) => s + b.commentCount, 0) + ' captured comment(s).');
  }

  /**
   * Creates a floating modal popup for Comprehensive Summary content
   */
  function createSummaryPopup(contentData) {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.25);
      z-index: 1000001;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
    `;

    const popup = document.createElement("div");
    popup.style.cssText = `
      width: min(85vw, 960px);
      max-height: 85vh;
      background: var(--color-bg);
      border: 2px solid var(--color-border);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 0 0 1px oklch(75% 0.02 270);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: fadeIn 0.25s ease-out;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid var(--color-border);
      background: var(--color-bg);
      border-radius: 12px 12px 0 0;
      flex-shrink: 0;
    `;
    header.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; font-weight:600; font-size:16px; color:var(--color-text);">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12Z" stroke="var(--color-primary)" stroke-width="1.8" fill="none"/>
          <path d="M12 6C15.31 6 18 8.69 18 12C18 15.31 15.31 18 12 18C8.69 18 6 15.31 6 12C6 8.69 8.69 6 12 6Z" stroke="var(--color-primary)" stroke-width="1.8" fill="none" opacity="0.3"/>
          <circle cx="12" cy="12" r="3" stroke="var(--color-primary)" stroke-width="1.8" fill="none"/>
        </svg>
        Comprehensive Summary
      </div>
      <button style="
        background: transparent;
        border: 1px solid transparent;
        cursor: pointer;
        padding: 6px 8px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        line-height: 1;
        color: var(--color-text-muted);
        transition: all 0.15s ease-out;
      " aria-label="Close summary popup">✕</button>
    `;

    // Body
    const body = document.createElement("div");
    body.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 24px 28px;
      font-size: 14.5px;
      line-height: 1.7;
      color: var(--color-text);
      scroll-behavior: smooth;
    `;
    body.innerHTML = normalizeContent(contentData);

    // Close button hover
    const closeBtn = header.querySelector('button');
    closeBtn.onmouseenter = () => {
      closeBtn.style.background = 'var(--color-bg-hover)';
      closeBtn.style.color = 'var(--color-text)';
    };
    closeBtn.onmouseleave = () => {
      closeBtn.style.background = 'transparent';
      closeBtn.style.color = 'var(--color-text-muted)';
    };

    // Close handlers
    closeBtn.onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    // Keyboard close (Escape)
    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);

    popup.appendChild(header);
    popup.appendChild(body);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    return overlay;
  }

  function render(data) {
    content.innerHTML = "";

    const analysis = data.analysis || {};

    // ===== Main tabs: Summary / Details =====
    const mainTabBar = document.createElement("div");
    mainTabBar.style.cssText = `
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--color-border-light);
      padding-bottom: 10px;
    `;

    const summaryTab = document.createElement("button");
    summaryTab.type = "button";
    summaryTab.textContent = "Summary";
    summaryTab.className = "btn-base btn-action";

    const detailsTab = document.createElement("button");
    detailsTab.type = "button";
    detailsTab.textContent = "Details";
    detailsTab.className = "btn-base btn-action";

    function setMainTabStyle(activeButton, inactiveButton) {
      activeButton.style.cssText = `
        flex: 1;
        padding: 10px 14px;
        font-size: 14px;
        font-weight: 700;
        background: var(--color-primary);
        color: white;
        border: 2px solid var(--color-primary);
        border-radius: 8px;
        cursor: pointer;
        transform: none;
      `;

      inactiveButton.style.cssText = `
        flex: 1;
        padding: 10px 14px;
        font-size: 14px;
        font-weight: 700;
        background: var(--color-bg);
        color: var(--color-text-muted);
        border: 2px solid var(--color-border);
        border-radius: 8px;
        cursor: pointer;
        transform: none;
      `;
    }

    mainTabBar.appendChild(summaryTab);
    mainTabBar.appendChild(detailsTab);
    content.appendChild(mainTabBar);

    // ===== Summary view =====
    const summaryView = document.createElement("div");
    summaryView.style.display = "block";

    const summaryCard = document.createElement("div");
    summaryCard.style.cssText = `
      background: var(--color-bg);
      border: 2px solid var(--color-primary);
      border-radius: 10px;
      padding: 18px 20px;
      box-shadow: var(--shadow-sm);
      line-height: 1.7;
      font-size: 14.5px;
      color: var(--color-text);
      margin-bottom: 16px;
    `;

    summaryCard.innerHTML = normalizeContent(
      analysis.summary || analysis.content || data.meta || "No comment analysis result available."
    );

    summaryView.appendChild(summaryCard);

    // ===== Details view =====
    const detailsView = document.createElement("div");
    detailsView.style.display = "none";

    const detailNav = document.createElement("div");
    detailNav.style.cssText = `
      display: flex;
      flex-wrap: nowrap;
      gap: 5px;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--color-border-light);
      overflow-x: auto;
      overflow-y: hidden;
      white-space: nowrap;
      scrollbar-width: thin;
    `;

    const detailContent = document.createElement("div");
    detailContent.style.cssText = `
      background: var(--color-bg);
      border: 2px solid var(--color-border);
      border-radius: 10px;
      padding: 18px 20px;
      line-height: 1.7;
      font-size: 14px;
      color: var(--color-text);
      box-shadow: var(--shadow-sm);
    `;

    const detailSections = [
      {
        key: "Insight",
        title: "Comprehensive Summary",
        content: data.meta || "No comprehensive summary available."
      },
      {
        key: "Structure",
        title: "Interaction Structure",
        content: analysis.structural || "No structure analysis available."
      },
      {
        key: "Engage",
        title: "Engagement Distribution",
        content: analysis.engagement || "No engagement analysis available."
      },
      {
        key: "Time",
        title: "Temporal Trend",
        content: analysis.temporal || "No temporal analysis available."
      },
      {
        key: "Quality",
        title: "Discussion Quality",
        content: analysis.quality || "No quality analysis available."
      },
      {
        key: "Metrics",
        title: "Advanced Metrics",
        content: data.rules || "No metrics available."
      }
    ];

    function styleDetailButton(button, isActive) {
      button.style.cssText = `
        flex: 0 0 auto;
        height: 32px;
        padding: 0 8px;
        box-sizing: border-box;
        border-radius: 7px;
        border: 1px solid ${isActive ? "var(--color-primary)" : "var(--color-border)"};
        background: ${isActive ? "var(--color-primary)" : "var(--color-bg)"};
        color: ${isActive ? "white" : "var(--color-text-muted)"};
        cursor: pointer;
        font-size: 11.5px;
        font-weight: 600;
        font-family: inherit;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
        transform: none;
        transition: background 0.15s ease-out, color 0.15s ease-out, border-color 0.15s ease-out;
      `;
    }

    function renderDetailContent(section) {
      detailContent.innerHTML = "";

      const detailHeader = document.createElement("div");
      detailHeader.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--color-border-light);
      `;

      const detailTitle = document.createElement("div");
      detailTitle.textContent = section.title;
      detailTitle.style.cssText = `
        font-size: 15px;
        font-weight: 700;
        color: var(--color-text);
      `;

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.innerHTML = ICON_COPY_SVG;
      copyBtn.title = "Copy this section";
      copyBtn.setAttribute("aria-label", "Copy this section");
      copyBtn.style.cssText = `
        width: 30px;
        height: 30px;
        border-radius: 6px;
        border: 1px solid var(--color-border);
        background: var(--color-bg);
        color: var(--color-text-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        flex-shrink: 0;
        transform: none;
      `;

      const detailBody = document.createElement("div");
      detailBody.innerHTML = normalizeContent(section.content);

      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(`${section.title}\n\n${detailBody.innerText}`);
          copyBtn.textContent = "✓";
          setTimeout(() => {
            copyBtn.innerHTML = ICON_COPY_SVG;
          }, 1000);
        } catch (err) {
          console.error("copy failed:", err);
          copyBtn.textContent = "!";
          setTimeout(() => {
            copyBtn.innerHTML = ICON_COPY_SVG;
          }, 1000);
        }
      };

      detailHeader.appendChild(detailTitle);
      detailHeader.appendChild(copyBtn);

      detailContent.appendChild(detailHeader);
      detailContent.appendChild(detailBody);
    }

    function showDetailSection(section, clickedButton) {
      detailNav.querySelectorAll("button").forEach(btn => {
        styleDetailButton(btn, btn === clickedButton);
      });

      renderDetailContent(section);
      content.scrollTop = 0;
    }

    detailSections.forEach((section, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = section.key;
      btn.setAttribute("aria-label", `Open ${section.title}`);
      styleDetailButton(btn, index === 0);

      btn.onclick = () => {
        showDetailSection(section, btn);
      };

      detailNav.appendChild(btn);

      if (index === 0) {
        renderDetailContent(section);
      }
    });

    // Move Visual into the Details navigation area.
    if (typeof visualBth !== "undefined" && visualBth) {
      visualBth.textContent = "Visual";
      visualBth.className = "";
      visualBth.setAttribute("aria-label", "Open visual analysis");
      styleDetailButton(visualBth, false);
      detailNav.appendChild(visualBth);
    }

    detailsView.appendChild(detailNav);
    detailsView.appendChild(detailContent);

    content.appendChild(summaryView);
    content.appendChild(detailsView);

    function showSummary() {
      summaryView.style.display = "block";
      detailsView.style.display = "none";
      setMainTabStyle(summaryTab, detailsTab);
      content.scrollTop = 0;
    }

    function showDetails() {
      summaryView.style.display = "none";
      detailsView.style.display = "block";
      setMainTabStyle(detailsTab, summaryTab);
      content.scrollTop = 0;
    }

    summaryTab.onclick = showSummary;
    detailsTab.onclick = showDetails;

    showSummary();
  }

  function createSection(title, text) {
    const wrapper = document.createElement("div");
    wrapper.className = "analysis-section";

    // --- 标题栏 (使用Flex布局，左侧标题，右侧按钮组) ---
    const titleDiv = document.createElement("div");
    titleDiv.className = "analysis-title";
    titleDiv.style.display = "flex";
    titleDiv.style.justifyContent = "space-between";
    titleDiv.style.alignItems = "center";

    // 标题文本
    const titleSpan = document.createElement("span");
    titleSpan.innerText = title;

    // 右侧容器：复制按钮 + 折叠按钮
    const rightGroup = document.createElement("div");
    rightGroup.style.display = "flex";
    rightGroup.style.gap = "12px";
    rightGroup.style.alignItems = "center";

    // 复制按钮
    const copyBtn = document.createElement("span");
    copyBtn.innerText = "copy";
    copyBtn.style.cursor = "pointer";
    copyBtn.style.fontSize = "0.9em";
    copyBtn.style.userSelect = "none";
    copyBtn.style.padding = "2px 6px";
    copyBtn.style.borderRadius = "4px";
    copyBtn.style.transition = "background 0.2s";
    copyBtn.style.background = "transparent";
    copyBtn.onmouseenter = () => copyBtn.style.background = "var(--color-bg-hover)";
    copyBtn.onmouseleave = () => copyBtn.style.background = "transparent";

    // 折叠/展开按钮
    const toggleSpan = document.createElement("span");
    toggleSpan.innerText = "➕";
    toggleSpan.style.cursor = "pointer";
    toggleSpan.style.color = "var(--color-text-muted)";
    toggleSpan.style.fontWeight = "bold";
    toggleSpan.style.fontSize = "1.1em";

    rightGroup.appendChild(copyBtn);
    rightGroup.appendChild(toggleSpan);

    titleDiv.appendChild(titleSpan);
    titleDiv.appendChild(rightGroup);

    // --- 内容区域 ---
    const body = document.createElement("div");
    body.className = "analysis-body";
    body.innerHTML = normalizeContent(text);

    // 默认折叠：内容隐藏，符号显示“＋”
    body.style.display = "none";

    // --- 折叠/展开逻辑 ---
    titleDiv.onclick = (e) => {

        if (e.target === copyBtn || copyBtn.contains(e.target)) return;
        const isOpen = body.style.display === "block";
        body.style.display = isOpen ? "none" : "block";
        toggleSpan.innerText = isOpen ? "➕" : "➖";
    };

    // --- 复制逻辑（带临时反馈）---
    let copyTimer = null;
    copyBtn.onclick = async (e) => {
        e.stopPropagation(); // 阻止冒泡，避免触发折叠/展开

        // 复制内容：标题 + 换行 + 正文纯文本（不包含任何按钮/符号）
        const contentToCopy = `${title}\n\n${body.innerText}`;
        try {
            await navigator.clipboard.writeText(contentToCopy);
            // 临时改变按钮文字反馈
            const originalText = copyBtn.innerText;
            copyBtn.innerText = "copied";
            if (copyTimer) clearTimeout(copyTimer);
            copyTimer = setTimeout(() => {
                copyBtn.innerText = originalText;
                copyTimer = null;
            }, 1500);
        } catch (err) {
            console.error("copy failed: ", err);
            const originalText = copyBtn.innerText;
            copyBtn.innerText = "❌ failed";
            if (copyTimer) clearTimeout(copyTimer);
            copyTimer = setTimeout(() => {
                copyBtn.innerText = originalText;
                copyTimer = null;
            }, 1500);
        }
    };

    wrapper.appendChild(titleDiv);
    wrapper.appendChild(body);

    return wrapper;
  }


  const btnContainer = document.createElement("div");
  btnContainer.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0px;
    padding: 6px;
    border-radius: 12px;
    background: var(--color-bg);
    border: 2px solid var(--color-border);
    box-shadow: var(--shadow-elevated);
    z-index: 999999;
    font-family: inherit;
    transition: gap 0.35s ease-out-quart, padding 0.35s ease-out-quart, box-shadow 0.35s ease-out-quart;
  `;
  btnContainer.onmouseenter = () => {
    btnContainer.style.boxShadow = 'var(--shadow-elevated)';
    btnContainer.style.transform = 'translateY(-1px)';
  };
  btnContainer.onmouseleave = () => {
    btnContainer.style.boxShadow = 'var(--shadow-elevated)';
    btnContainer.style.transform = 'translateY(0)';
  };
  document.body.appendChild(btnContainer);

  let groupExpanded = false;

  // ===== 评论按钮（默认可见） =====
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.innerHTML = PLUGIN_LOGO_SVG;
  openBtn.className = 'floating-logo-button';
  openBtn.title = 'Open comments analyzer';
  openBtn.setAttribute('aria-label', 'Open comments analyzer');
  openBtn.style.cssText = `
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 2px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    box-shadow: var(--shadow-md);
    transition: all 0.2s ease-out;
  `;
  btnContainer.appendChild(openBtn);

  // ===== 次级按钮组（默认折叠） =====
  const btnSecondaryGroup = document.createElement("div");
  btnSecondaryGroup.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    width: 100%;
  `;

  const panelToolbar = document.createElement("div");
  panelToolbar.style.cssText = `
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border-light);
    background: var(--color-bg-hover);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  `;

panelToolbar.appendChild(btnSecondaryGroup);
panel.insertBefore(panelToolbar, content);


  function expandButtonGroup() {
    if (groupExpanded) return;

    // Keep the floating logo visible only when the panel is collapsed.
    btnContainer.style.display = 'none';

    groupExpanded = true;
    openPanel();
  }

  function collapseButtonGroup() {
    if (!groupExpanded) return;

    // Show the floating logo again when the panel is collapsed.
    btnContainer.style.display = 'flex';

    groupExpanded = false;
  }

  openBtn.onclick = expandButtonGroup;

  // ===== 分析（主按钮）=====
  const analyzeBtn = document.createElement("button");
  analyzeBtn.type = "button";
  analyzeBtn.textContent = "Analyze";
  analyzeBtn.className = 'btn-base btn-action';
  analyzeBtn.title = 'Analyze captured comments';
  analyzeBtn.style.cssText += `
    flex: 1;
    min-height: 40px;
    font-size: 14px;
    font-weight: 700;
    background: var(--color-primary);
    color: white;
    border: 2px solid var(--color-primary);
  `;

let analyzeRequestLocked = false;
let analyzeSafetyTimer = null;

function setAnalyzeRunning(isRunning) {
  analyzeRequestLocked = isRunning;

  if (typeof analyzeBtn !== "undefined" && analyzeBtn) {
    analyzeBtn.disabled = isRunning;
    analyzeBtn.textContent = isRunning ? "Analyzing..." : "Analyze";
    analyzeBtn.style.opacity = isRunning ? "0.65" : "1";
    analyzeBtn.style.cursor = isRunning ? "not-allowed" : "pointer";
  }
}

analyzeBtn.onclick = () => {
  if (analyzeRequestLocked) return;

  const fullComments = window.myPluginData?._fullComments || {};

  const ids = Object.keys(fullComments)
    .map(Number)
    .filter(Number.isFinite);

  const comments = Object.values(fullComments)
    .flat()
    .filter(c => c && c.text);

  if (!comments.length) {
    alert("No comments captured yet. Please wait for the page comments to load, then try again.");
    return;
  }

  setAnalyzeRunning(true);

  if (analyzeSafetyTimer) {
    clearTimeout(analyzeSafetyTimer);
  }

  analyzeSafetyTimer = setTimeout(() => {
    setAnalyzeRunning(false);
    analyzeSafetyTimer = null;
  }, 12 * 60 * 1000);

  openPanel();
  showLoading();

  console.log("[Injected] Sending analysis request", {
    blockIds: ids,
    commentCount: comments.length
  });

  window.postMessage({
    type: "REQUEST_ANALYSIS",
    blocks: ids,
    comments: comments
  }, "*");
};

btnSecondaryGroup.appendChild(analyzeBtn);

  // ===== 清除缓存 =====
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";

  clearBtn.innerHTML = ICON_TRASH_SVG;
  clearBtn.className = 'btn-icon';
  clearBtn.title = 'Clear captured comments';
  clearBtn.setAttribute('aria-label', 'Clear captured comments');
  clearBtn.style.cssText = `
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  `;

  clearBtn.onclick = (e) => {
    e.stopPropagation();

    if (confirm("Are you sure you want to clear all cached comment data? This action cannot be undone.")) {
      window.postMessage({
        type: "CLEAR_CACHE"
      }, "*");

      clearBtn.disabled = true;
      clearBtn.style.opacity = "0.6";
      clearBtn.style.cursor = "not-allowed";
      clearBtn.style.transform = "scale(0.95)";

      clearBtn.innerHTML = `
        <div class="spinner" style="
          width: 16px;
          height: 16px;
          border-width: 1px;
          border-color: var(--color-error);
          border-right-color: transparent;
        "></div>
      `;

      setTimeout(() => {
        clearBtn.disabled = false;
        clearBtn.innerHTML = ICON_TRASH_SVG;
        clearBtn.style.opacity = "1";
        clearBtn.style.cursor = "pointer";
        clearBtn.style.transform = "scale(1)";
      }, 1200);
    }
  };
  //btnSecondaryGroup.appendChild(clearBtn);

  // ===== 导出功能 =====
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";

  exportBtn.innerHTML = ICON_DOWNLOAD_SVG;
  exportBtn.className = 'btn-icon';
  exportBtn.title = 'Export captured comments';
  exportBtn.setAttribute('aria-label', 'Export captured comments');
  exportBtn.style.cssText = `
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  `;

  exportBtn.onclick = () => {
    exportBtn.style.transform = 'scale(0.95)';
    exportBtn.style.boxShadow = 'none';

    setTimeout(() => {
      exportBtn.style.transform = 'scale(1)';
      exportBtn.style.boxShadow = 'var(--shadow-sm)';
    }, 150);

    exportComments();
  };
  //btnSecondaryGroup.appendChild(exportBtn);

  // ===== 跳转可视化 =====
  const visualBth = document.createElement("button");
  visualBth.type = "button";
  visualBth.textContent = "Visual";
  visualBth.className = 'btn-base btn-action';
  visualBth.setAttribute('aria-label', 'Visualize analysis results');
  visualBth.title = 'Open analysis visualization in a new tab';
  visualBth.onclick = () => {
    const analysisData = window.myPluginData?.analysisResult || null;
    if (!analysisData) {
      alert("No analysis data available. Please run analysis first.");
      return;
    }

    // 添加加载动画
    const originalText = visualBth.textContent;
    visualBth.innerHTML = `
      <div class="spinner" style="width: 16px; height: 16px; border-width: 1px; border-color: var(--color-primary); border-right-color: transparent; margin-right: 6px;"></div>
      Loading...
    `;
    visualBth.disabled = true;

    const handler = (event) => {
      if (event.source !== window) return;
      if (event.data?.type === 'RESPONSE_VISUAL_URL') {
        window.removeEventListener('message', handler);
        window.open(event.data.url, '_blank');
        visualBth.innerHTML = originalText;
        visualBth.disabled = false;
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({
      type: 'REQUEST_VISUAL_URL',
      data: analysisData
    }, '*');

    setTimeout(() => {
      window.removeEventListener('message', handler);
      console.warn('Request visual URL timed out');
      visualBth.innerHTML = originalText;
      visualBth.disabled = false;
    }, 5000);
  };
  //btnSecondaryGroup.appendChild(visualBth);

  // ===== 查询历史 =====
  const historyBtn = document.createElement("button");
  historyBtn.type = "button";

  historyBtn.innerHTML = ICON_HISTORY_SVG;
  historyBtn.className = 'btn-icon';
  historyBtn.title = 'View analysis history';
  historyBtn.setAttribute('aria-label', 'View analysis history');
  historyBtn.style.cssText = `
    width: 40px;
    height: 40px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  `;

  historyBtn.onclick = () => {
    fetchHistory(1);
    createHistoryPopup(null);
  };
  btnSecondaryGroup.appendChild(historyBtn);

  (function enableDrag(el) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let moved = false;

    // 初始改为用 left/top 定位（从 right/bottom 转换）
    const rect = el.getBoundingClientRect();
    el.style.left = rect.left + "px";
    el.style.top = rect.top + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";

    const onDown = (e) => {
      isDragging = true;
      moved = false;

      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;

      const r = el.getBoundingClientRect();
      startLeft = r.left;
      startTop = r.top;

      // 防止选中文本
      document.body.style.userSelect = "none";
    };

    const onMove = (e) => {
      if (!isDragging) return;

      const point = e.touches ? e.touches[0] : e;
      const dx = point.clientX - startX;
      const dy = point.clientY - startY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;

      let newLeft = startLeft + dx;
      let newTop = startTop + dy;

      const maxLeft = window.innerWidth - el.offsetWidth;
      const maxTop = window.innerHeight - el.offsetHeight;

      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      el.style.left = newLeft + "px";
      el.style.top = newTop + "px";
    };

    const onUp = () => {
      isDragging = false;
      document.body.style.userSelect = "";
    };

    el.addEventListener("click", (e) => {
      if (moved) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    el.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    el.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onUp);

  })(btnContainer);



    const blockList = document.createElement("div");
    blockList.id = "comment-blocks";
    blockList.style.cssText = `
      padding: 10px 14px;
      border-bottom: 1px solid var(--color-border);
      border-top: 1px solid var(--color-border);
      background: transparent;
      max-height: 160px;
      overflow: auto;
      flex-shrink: 0;
      transition: max-height 0.2s ease-out;
    `;

  // 添加搜索功能
  const searchContainer = document.createElement("div");
  searchContainer.style.cssText = `
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border-light);
    background: var(--color-bg-hover);
    position: relative;
  `;

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "search comments...";
  searchInput.style.cssText = `
    padding: 8px 12px 8px 32px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 13px;
    transition: var(--transition-fast);
    width: 100%;
    box-sizing: border-box;
    position: relative;
    outline: none;
  `;

  // 添加搜索图标
  const searchIcon = document.createElement("svg");
  searchIcon.setAttribute("width", "16");
  searchIcon.setAttribute("height", "16");
  searchIcon.setAttribute("viewBox", "0 0 24 24");
  searchIcon.setAttribute("fill", "none");
  searchIcon.style.cssText = `
    position: absolute;
    left: 10px;
    top: 10px;
    color: var(--color-text-muted);
    pointer-events: none;
    transition: color 0.15s ease-out-quart;
  `;
  searchIcon.innerHTML = `
    <path d="M21 21L15 15M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  `;

  // 搜索清空按钮
  const clearSearchBtn = document.createElement("button");
  clearSearchBtn.textContent = "✕";
  clearSearchBtn.style.cssText = `
    position: absolute;
    right: 8px;
    top: 8px;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.15s ease-out-quart, background 0.15s ease-out-quart;
    padding: 0;
    line-height: 1;
  `;
  clearSearchBtn.onmouseenter = () => {
    clearSearchBtn.style.background = 'var(--color-bg-hover)';
    clearSearchBtn.style.color = 'var(--color-text)';
  };
  clearSearchBtn.onmouseleave = () => {
    clearSearchBtn.style.background = 'transparent';
    clearSearchBtn.style.color = 'var(--color-text-muted)';
  };
  clearSearchBtn.onclick = () => {
    searchInput.value = '';
    searchInput.focus();
    filterComments('');
    clearSearchBtn.style.opacity = '0';
  };

  searchInput.oninput = function() {
    filterComments(this.value);
    clearSearchBtn.style.opacity = this.value ? '0.6' : '0';
  };

  searchInput.onfocus = function() {
    searchIcon.style.color = 'var(--color-primary)';
    clearSearchBtn.style.opacity = this.value ? '0.6' : '0';
  };

  searchInput.onblur = function() {
    searchIcon.style.color = 'var(--color-text-muted)';
    clearSearchBtn.style.opacity = '0';
  };


  const searchResults = document.createElement("div");
  searchResults.id = "search-results";
  searchResults.style.cssText = `
    min-height: 16px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--color-text-muted);
    text-align: right;
    opacity: 0;
    transition: opacity 0.2s ease-out;
  `;

  searchContainer.appendChild(searchIcon);
  searchContainer.appendChild(clearSearchBtn);
  searchContainer.appendChild(searchInput);
  searchContainer.appendChild(searchResults);
  panel.insertBefore(blockList, content);

  // 评论过滤函数
// Filter the visible captured comments in the current comment list.
  function filterComments(searchTerm) {
    const term = (searchTerm || '').trim().toLowerCase();
    const commentItems = blockList.querySelectorAll('.comment-item');
    const moreItems = blockList.querySelectorAll('.more-comments');
    let visibleCount = 0;

    commentItems.forEach(item => {
      const text = item.textContent.toLowerCase();
      const isVisible = !term || text.includes(term);
      item.style.display = isVisible ? 'block' : 'none';
      if (isVisible) visibleCount++;
    });

    // Hide the preview-only hint while searching, so users only see matched comments.
    moreItems.forEach(item => {
      item.style.display = term ? 'none' : 'flex';
    });

    const resultsText = document.getElementById('search-results');
    if (resultsText) {
      if (term) {
        resultsText.textContent = `${visibleCount} comment(s) found`;
        resultsText.style.opacity = '1';
      } else {
        resultsText.textContent = '';
        resultsText.style.opacity = '0';
      }
    }
  }

  function renderBlocks(blocks) {

    blockList.innerHTML = "";
    window.myPluginData._fullComments = {};

    blocks.forEach(block => {
      if (block.comments) {
        window.myPluginData._fullComments[block.id] = block.comments;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "comment-block";
      wrapper.style.cssText = `
        border: 2px solid var(--color-border);
        border-radius: 8px;
        margin-bottom: 8px;
        background: var(--color-bg);
        overflow: hidden;
        box-shadow: var(--shadow-sm);
        font-size: 13px;
        transition: border-color 0.15s ease-out-quart, box-shadow 0.15s ease-out-quart, transform 0.1s ease-out-quart;
      `;
      wrapper.onmouseenter = () => {
        wrapper.style.borderColor = 'var(--color-primary)';
        wrapper.style.boxShadow = 'var(--shadow-lift)';
        wrapper.style.transform = 'translateY(-1px)';
      };
      wrapper.onmouseleave = () => {
        wrapper.style.borderColor = 'var(--color-border)';
        wrapper.style.boxShadow = 'var(--shadow-sm)';
        wrapper.style.transform = 'translateY(0)';
      };
      wrapper.onmousedown = () => {
        wrapper.style.transform = 'translateY(1px) scale(0.995)';
        wrapper.style.boxShadow = 'none';
      };
      wrapper.onmouseup = () => {
        wrapper.style.transform = 'translateY(0) scale(1)';
        wrapper.style.boxShadow = 'var(--shadow-sm)';
      };

      /* 标题行 */
      const header = document.createElement("div");
      header.className = "block-header";
      header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        min-height: 40px;
        background: var(--color-bg);
        cursor: pointer;
        transition: background 0.15s ease-out-quart;
        border-radius: 8px 8px 0 0;
      `;
      header.setAttribute('aria-expanded', 'false');
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      header.setAttribute('aria-label', `Toggle Comment Block #${block.id} details`);

      const left = document.createElement("div");
      left.innerHTML = `
        <div style="
          color: var(--color-text);
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        ">
          Captured comments
        </div>
      `;

      const right = document.createElement("div");
      right.style.cssText = `
        color: var(--color-text-muted);
        font-size: 12px;
        display: flex;
        gap: 8px;
        align-items: center;
        font-weight: 500;
      `;

      const commentActions = document.createElement("div");
      commentActions.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
      `;

      commentActions.appendChild(exportBtn);
      commentActions.appendChild(clearBtn);

      const countSpan = document.createElement("span");
      countSpan.textContent = `${block.count} comment(s)`;

      const toggleIcon = document.createElement("span");
      toggleIcon.className = "toggle-icon";
      toggleIcon.innerText = "▼";
      toggleIcon.setAttribute("aria-hidden", "true");
      toggleIcon.style.cssText = `
        font-size: 14px;
        color: var(--color-text-light);
      `;

      right.appendChild(commentActions);
      right.appendChild(countSpan);
      right.appendChild(toggleIcon);

      header.appendChild(left);
      header.appendChild(right);

      wrapper.appendChild(header);

      const body = document.createElement("div");
      body.className = "block-body";
      body.style.cssText = `
        display: none;
        flex-direction: column;
        border-top: 2px solid var(--color-border-light);
        flex: 1;
        min-height: 0;
        overflow: hidden;
        padding: 0;
        background: var(--color-bg);
        transition: background 0.15s ease-out;
        border-radius: 0 0 8px 8px;
      `;

      const commentList = document.createElement("div");
      commentList.className = "comment-list";
      commentList.style.cssText = `
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 10px 14px;
      `;

      // Keep the search box inside the expanded captured comments area.
      body.appendChild(searchContainer);
      body.appendChild(commentList);

      const texts = Array.isArray(block.comments) && block.comments.length
        ? block.comments.map(c => c?.text || '').filter(Boolean)
        : (block.preview || []);

      if (texts.length === 0) {

        commentList.innerHTML = `<div style="
          color: var(--color-text-light);
          font-size: 12px;
          text-align: center;
          padding: 14px 0;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <span style="display: flex; align-items: center; gap: 6px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="opacity: 0.5;">
              <path d="M2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12Z" stroke="currentColor" stroke-width="2" fill="none"/>
            </svg>
            No comments available
          </span>
        </div>`;

      } else {

        texts.forEach(text => {

          const item = document.createElement("div");

          item.className = "comment-item";
          item.style.cssText = `
            padding: 10px 0;
            border-bottom: 1px solid var(--color-border-light);
            line-height: 1.6;
            color: var(--color-text);
            font-size: 13px;
            transition: background 0.1s ease-out-quart;
          `;
          item.onmouseenter = () => {
            item.style.background = 'oklch(96% 0.01 270)';
          };
          item.onmouseleave = () => {
            item.style.background = '';
          };

          item.innerText = text;

          commentList.appendChild(item);

        });

        if (block.count > texts.length) {

          const more = document.createElement("div");

          more.className = "more-comments";
          more.style.cssText = `
            padding-top: 12px;
            padding-bottom: 12px;
            color: var(--color-text-muted);
            font-size: 12px;
            text-align: center;
            font-style: italic;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
          `;
          more.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="opacity: 0.4;">
            <path d="M5 9L12 12L19 9V17L12 20L5 17V9Z" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="square" stroke-linejoin="square"/>
          </svg><span>remaining ${block.count - texts.length} comments hidden</span>`;

          commentList.appendChild(more);

        }

      }

      wrapper.appendChild(body);

      /* 展开收起 */
      header.onclick = (e) => {
        if (e.target.closest('button')) return;
        const isOpen = body.style.display === "flex";

        if (isOpen) {
          // Collapse captured comments and restore the analysis area.
          body.style.display = "none";
          wrapper.style.height = "";
          wrapper.style.display = "";
          blockList.style.flex = "0 0 auto";
          blockList.style.maxHeight = "180px";
          blockList.style.overflow = "auto";
          content.style.display = "";

          header.setAttribute('aria-expanded', 'false');
          right.querySelector(".toggle-icon").innerText = "▼";
          return;
        }

        // Expand captured comments to cover the remaining panel area.
        content.style.display = "none";
        blockList.style.flex = "1 1 auto";
        blockList.style.maxHeight = "none";
        blockList.style.overflow = "hidden";

        wrapper.style.height = "100%";
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";

        body.style.display = "flex";
        filterComments(searchInput.value);

        header.setAttribute('aria-expanded', 'true');
        right.querySelector(".toggle-icon").innerText = "▲";
      };


      blockList.appendChild(wrapper);

    });

  }

  // ===== History =====
  let historyCurrentOverlay = null;

  function fetchHistory(page) {
    window.postMessage({
      type: "REQUEST_HISTORY",
      page: page || 1,
      pageSize: 20
    }, "*");
  }

  function fetchAnalysisDetail(id) {
    window.postMessage({
      type: "REQUEST_ANALYSIS_DETAIL",
      id: id
    }, "*");
    openPanel();
    showLoading();
  }

  function createHistoryPopup(data) {
    if (historyCurrentOverlay) {
      historyCurrentOverlay.remove();
      historyCurrentOverlay = null;
    }

    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.25);
      z-index: 1000002;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
    `;
    historyCurrentOverlay = overlay;

    const popup = document.createElement("div");
    popup.style.cssText = `
      width: min(85vw, 720px);
      max-height: 85vh;
      background: var(--color-bg);
      border: 2px solid var(--color-border);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 0 0 1px oklch(75% 0.02 270);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: fadeIn 0.25s ease-out;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid var(--color-border);
      background: var(--color-bg);
      border-radius: 12px 12px 0 0;
      flex-shrink: 0;
    `;
    header.innerHTML = `
  <div style="display:flex; align-items:center; gap:10px; font-weight:600; font-size:16px; color:var(--color-text);">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="var(--color-primary)" stroke-width="1.8" fill="none"/>
      <path d="M12 6V12L16 14" stroke="var(--color-primary)" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
    Analysis History
  </div>
  <button style="
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    padding: 6px 8px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    line-height: 1;
    color: var(--color-text-muted);
    transition: all 0.15s ease-out;
  " aria-label="Close history popup">✕</button>
`;

    const closeBtn = header.querySelector('button');
    closeBtn.onmouseenter = function() {
      closeBtn.style.background = 'var(--color-bg-hover)';
      closeBtn.style.color = 'var(--color-text)';
    };
    closeBtn.onmouseleave = function() {
      closeBtn.style.background = 'transparent';
      closeBtn.style.color = 'var(--color-text-muted)';
    };
    closeBtn.onclick = function() {
      overlay.remove();
      historyCurrentOverlay = null;
    };

    const body = document.createElement("div");
    body.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      scroll-behavior: smooth;
    `;

    const footer = document.createElement("div");
    footer.style.cssText = `
      padding: 12px 20px;
      border-top: 1px solid var(--color-border-light);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      flex-shrink: 0;
      background: var(--color-bg);
      border-radius: 0 0 12px 12px;
    `;

    function buildBody(items, page, totalPages) {
      body.innerHTML = '';

      if (!items || items.length === 0) {
        body.innerHTML = `
          <div style="text-align:center; padding:48px 0; color:var(--color-text-muted);">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style="margin-bottom:12px; opacity:0.3;">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" fill="none"/>
              <path d="M12 8V12M12 16H12.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <div style="font-size:14px;">No analysis history found</div>
          </div>
        `;
        return;
      }

      items.forEach(function(item) {
        var time = item.created_at ? new Date(item.created_at).toLocaleString() : 'Unknown';
        var structureLabel = item.structure_rule || 'N/A';
        var engagementLabel = item.engagement_rule || 'N/A';
        var statusLabel = item.status || 'unknown';
        var statusColor = statusLabel === 'completed' ? 'var(--color-success)' : 'var(--color-warning)';

        var card = document.createElement("div");
        card.style.cssText = `
          border: 2px solid var(--color-border);
          border-radius: 8px;
          padding: 14px 16px;
          margin-bottom: 10px;
          background: var(--color-bg);
          cursor: pointer;
          transition: all 0.15s ease-out-quart;
          display: flex;
          align-items: center;
          justify-content: space-between;
        `;
        card.onmouseenter = function() {
          card.style.borderColor = 'var(--color-primary)';
          card.style.boxShadow = 'var(--shadow-lift)';
          card.style.transform = 'translateY(-1px)';
        };
        card.onmouseleave = function() {
          card.style.borderColor = 'var(--color-border)';
          card.style.boxShadow = 'none';
          card.style.transform = 'translateY(0)';
        };

        card.innerHTML = `
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:6px;">
              <span style="font-weight:600; font-size:14px; color:var(--color-primary);">#${item.id}</span>
              <span style="font-size:12px; color:var(--color-text-muted);">${time}</span>
            </div>
            <div style="display:flex; gap:16px; font-size:12px; color:var(--color-text-light); flex-wrap:wrap;">
              <span>comment ${item.comment_count || 0}</span>
              <span>user ${item.user_count || 0}</span>
              <span>structure ${structureLabel}</span>
              <span>engagement ${engagementLabel}</span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
            <span style="
              font-size:11px;
              font-weight:500;
              color:${statusColor};
              background:oklch(92% 0.02 270);
              padding:3px 8px;
              border-radius:4px;
            ">${statusLabel}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="color:var(--color-text-muted);">
              <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        `;

        card.onclick = function() {
          overlay.remove();
          historyCurrentOverlay = null;
          fetchAnalysisDetail(item.id);
        };

        body.appendChild(card);
      });
    }

    function buildFooter(page, totalPages) {
      footer.innerHTML = '';

      var prevBtn = document.createElement("button");
      prevBtn.textContent = "Previous";
      prevBtn.disabled = page <= 1;
      prevBtn.style.cssText = `
        padding: 6px 14px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: ${page <= 1 ? 'var(--color-bg-hover)' : 'var(--color-bg)'};
        color: ${page <= 1 ? 'var(--color-text-muted)' : 'var(--color-text)'};
        cursor: ${page <= 1 ? 'default' : 'pointer'};
        font-size: 12px;
        font-family: inherit;
        transition: all 0.15s ease-out;
      `;
      prevBtn.onclick = function() {
        if (page > 1) {
          body.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:200px;"><div class="spinner"></div></div>';
          footer.innerHTML = '';
          fetchHistory(page - 1);
        }
      };

      var nextBtn = document.createElement("button");
      nextBtn.textContent = "Next";
      nextBtn.disabled = page >= totalPages;
      nextBtn.style.cssText = `
        padding: 6px 14px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: ${page >= totalPages ? 'var(--color-bg-hover)' : 'var(--color-bg)'};
        color: ${page >= totalPages ? 'var(--color-text-muted)' : 'var(--color-text)'};
        cursor: ${page >= totalPages ? 'default' : 'pointer'};
        font-size: 12px;
        font-family: inherit;
        transition: all 0.15s ease-out;
      `;
      nextBtn.onclick = function() {
        if (page < totalPages) {
          body.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:200px;"><div class="spinner"></div></div>';
          footer.innerHTML = '';
          fetchHistory(page + 1);
        }
      };

      var pageInfo = document.createElement("span");
      pageInfo.style.cssText = `
        font-size: 12px;
        color: var(--color-text-muted);
        min-width: 60px;
        text-align: center;
      `;
      pageInfo.textContent = (page || 1) + ' / ' + (totalPages || 1);

      footer.appendChild(prevBtn);
      footer.appendChild(pageInfo);
      footer.appendChild(nextBtn);
    }

    if (data) {
      buildBody(data.items, data.page, data.total_pages);
      buildFooter(data.page, data.total_pages);
    } else {
      body.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:200px;"><div class="spinner"></div></div>';
    }

    var keyHandler = function(e) {
      if (e.key === 'Escape') {
        overlay.remove();
        historyCurrentOverlay = null;
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);

    overlay.onclick = function(e) {
      if (e.target === overlay) {
        overlay.remove();
        historyCurrentOverlay = null;
      }
    };

    popup.appendChild(header);
    popup.appendChild(body);
    popup.appendChild(footer);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
  }

  window.myPluginData = window.myPluginData || {};

  window.addEventListener("message", (event) => {

    if (event.source !== window) return;

    if (event.data?.type === "BLOCKS_UPDATE") {
      renderBlocks(event.data.data);
    }

    if (event.data?.type === "ANALYSIS_RESULT") {
      if (analyzeSafetyTimer) {
        clearTimeout(analyzeSafetyTimer);
        analyzeSafetyTimer = null;
      }

      setAnalyzeRunning(false);

      window.myPluginData.analysisResult = event.data.data;
      render(event.data.data);
    }

    if (event.data?.type === "HISTORY_RESULT") {
      createHistoryPopup(event.data.data);
    }

    if (event.data?.type === "ANALYSIS_DETAIL_RESULT") {
      window.myPluginData.analysisResult = event.data.data;
      render(event.data.data);
    }

    if (event.data?.type === "ANALYSIS_ERROR") {
      if (analyzeSafetyTimer) {
        clearTimeout(analyzeSafetyTimer);
        analyzeSafetyTimer = null;
      }

      setAnalyzeRunning(false);

      content.innerHTML = `
        <div style="
          padding: 18px 20px;
          border: 2px solid var(--color-error);
          border-radius: 10px;
          color: var(--color-error);
          background: var(--color-bg);
          line-height: 1.6;
          font-size: 14px;
        ">
          ${escapeHtml(event.data.message || "Analysis request failed.")}
        </div>
      `;
    }

  });


}
}
)();
