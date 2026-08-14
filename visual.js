function renderCharts(data) {
    if (!data) {
        console.error('renderCharts was called with empty data');
        showErrorState('No valid data available');
        return;
    }

    console.log('Full data:', data);

    // 安全获取各个模块
    const global = data.global || { n: 0, users: 0, hot_ratio: 0 };
    const depth = data.depth || { mean: 0, max: 0, deep_ratio: 0, hist: [] };
    const branch = data.branch || { mean: 0, hist: [] };
    const like = data.like || { mean: 0, hist: [] };
    const time = data.time || { mean_h: 0, span_h: 0, weight: 0, hist: [] };
    const text = data.text || { mean_len: 0, hist: [] };
    const thread = data.thread || { count: 0, mean_size: 0, max_size: 0, mean_depth: 0 };
    const hot = data.hot || { mean: 0 };

    // 1. 渲染核心指标卡片
    const statsContainer = document.getElementById('stats-grid');
    if (statsContainer) {
        statsContainer.innerHTML = `
            <div class="stat-item">
                <div class="stat-icon">📝</div>
                <div class="stat-label">Total number of comments</div>
                <div class="stat-value">${global.n}</div>
            </div>
            <div class="stat-item">
                <div class="stat-icon">👥</div>
                <div class="stat-label">Total participating users</div>
                <div class="stat-value">${global.users}</div>
            </div>
            <div class="stat-item">
                <div class="stat-icon">🔥</div>
                <div class="stat-label">Popular ratio</div>
                <div class="stat-value">${(global.hot_ratio * 100).toFixed(1)}<span class="stat-unit">%</span></div>
            </div>
            <div class="stat-item">
                <div class="stat-icon">📏</div>
                <div class="stat-label">Average depth</div>
                <div class="stat-value">${depth.mean}</div>
            </div>
            <div class="stat-item">
                <div class="stat-icon">🔻</div>
                <div class="stat-label">Deep proportion</div>
                <div class="stat-value">${(depth.deep_ratio * 100).toFixed(1)}<span class="stat-unit">%</span></div>
            </div>
            <div class="stat-item">
                <div class="stat-icon">🌿</div>
                <div class="stat-label">Average branching</div>
                <div class="stat-value">${branch.mean}</div>
            </div>
            <div class="stat-item">
                <div class="stat-icon">❤️</div>
                <div class="stat-label">Average likes</div>
                <div class="stat-value">${like.mean}</div>
            </div>
            <div class="stat-item">
                <div class="stat-icon">⏱️</div>
                <div class="stat-label">Response time</div>
                <div class="stat-value">${time.mean_h}<span class="stat-unit">h</span></div>
            </div>
            <div class="stat-item">
                <div class="stat-icon">📄</div>
                <div class="stat-label">Text length</div>
                <div class="stat-value">${text.mean_len}</div>
            </div>
            <div class="stat-item">
                <div class="stat-icon">🎯</div>
                <div class="stat-label">Popular score</div>
                <div class="stat-value">${hot.mean.toFixed(3)}</div>
            </div>
        `;
    }

    // 2. 绘制直方图
    const histograms = [
        { id: 'depth-hist', title: 'Comment depth distribution', desc: 'the proportion of comments at each depth level', data: depth.hist, labels:['0','1','2','>=3'], xName: 'depth level', yName: 'frequency' },
        { id: 'branch-hist', title: 'Branch count distribution', desc: 'distribution of sub-comment counts', data: branch.hist, labels:['0','1-3','4-10','>10'], xName: 'sub-comment count', yName: 'frequency' },
        { id: 'like-hist', title: 'Like count distribution', desc: 'distribution of likes', data: like.hist, labels:['0','1-10','11-100','>100'], xName: 'like counts', yName: 'frequency' },
        { id: 'time-hist', title: 'Response time distribution', desc: 'distribution of response intervals (in hours)', data: time.hist,labels:['0-6h','6-24h','24-72h','>72h'],  xName: 'time interval', yName: 'frequency' },
        { id: 'text-hist', title: 'Text length distribution', desc: 'distribution of comment character counts', data: text.hist, labels:['0-50','51-200','>200'],  xName: 'length range', yName: 'frequency' }
    ];

    const chartsContainer = document.getElementById('charts-grid');
    if (chartsContainer) {
        chartsContainer.innerHTML = '';
        
        histograms.forEach(h => {
            if (h.data && Array.isArray(h.data) && h.data.length > 0) {
                const chartCard = document.createElement('div');
                chartCard.className = 'chart-card';
                chartCard.innerHTML = `
                    <div class="chart-card-header">
                        <h4>${h.title}</h4>
                        <p style="font-size: 12px; color: #8890a4; margin-top: 4px;">${h.desc}</p>
                    </div>
                    <div id="${h.id}" class="chart-container"></div>
                `;
                chartsContainer.appendChild(chartCard);

                // 确保容器已经添加到 DOM 后再初始化图表
                setTimeout(() => {
                    const chartDom = document.getElementById(h.id);
                    if (chartDom && typeof echarts !== 'undefined') {
                        const chart = echarts.init(chartDom);
                        chart.setOption({
                            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                            grid: { top: 40, left: 55, right: 20, bottom: 30, containLabel: true },
                            xAxis: { 
                                type: 'category', 
                                name: h.xName,
                                nameLocation: 'middle',
                                nameGap: 35,
                                data: h.labels, 
                                axisLabel: { fontSize: 11 }
                            },
                            yAxis: { 
                                type: 'value', 
                                name: h.yName,
                                nameLocation: 'middle',
                                nameGap: 45,
                                axisLabel: { fontSize: 11 }
                            },
                            series: [{
                                data: h.data,
                                type: 'bar',
                                barWidth: '55%',
                                itemStyle: { 
                                    borderRadius: [6, 6, 0, 0],
                                    color: '#3b82f6'
                                },
                                label: {
                                    show: true,
                                    position: 'top',
                                    formatter: (params) => (params.value * 100).toFixed(1) + '%',
                                    fontSize: 11
                                }
                            }]
                        });
                    } else {
                        console.warn(`Chart ${h.id} initialization failed`);
                    }
                }, 50);
            } else {
                console.warn(`Invalid histogram data for ${h.title}`, h.data);
            }
        });
    }

    // 3. 线程统计展示
    const threadContainer = document.getElementById('thread-stats-grid');
    if (threadContainer && thread) {
        threadContainer.innerHTML = `
            <div class="thread-stat-item">
                <div class="thread-stat-value">${thread.count}</div>
                <div class="thread-stat-label">Total number of conversations</div>
            </div>
            <div class="thread-stat-item">
                <div class="thread-stat-value">${thread.mean_size}</div>
                <div class="thread-stat-label">Average thread size</div>
            </div>
            <div class="thread-stat-item">
                <div class="thread-stat-value">${thread.max_size}</div>
                <div class="thread-stat-label">Maximum thread size</div>
            </div>
            <div class="thread-stat-item">
                <div class="thread-stat-value">${thread.mean_depth}</div>
                <div class="thread-stat-label">Average thread depth</div>
            </div>
        `;
    }
}

function showErrorState(message) {
    document.body.innerHTML = `
        <div class="error-state">
            <h2>⚠️ Error</h2>
            <p>${message}</p>
        </div>
    `;
}

// Read analysis data from Chrome storage and render visual charts.
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['analysisData'], (result) => {
        const storedData = result.analysisData;

        if (!storedData) {
            console.warn('No analysis data found in storage.');
            showErrorState('No analysis data found. Please return to the original page and run the analysis again.');
            return;
        }

        const analysisData = storedData.features;

        if (!analysisData) {
            console.error('analysisData.features is missing.', storedData);
            showErrorState('Invalid analysis data format: missing features.');
            return;
        }

        if (!analysisData.global || typeof analysisData.global.n !== 'number') {
            console.error('Invalid analysis data structure.', analysisData);
            showErrorState('Invalid analysis data format. Please check the backend output.');
            return;
        }

        console.log('Analysis data loaded from storage:', analysisData);
        renderCharts(analysisData);

        chrome.storage.local.remove('analysisData');
    });
});