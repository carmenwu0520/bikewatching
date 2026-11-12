// Step 1.1 + 3: 用 ES module 引入 Mapbox 和 D3
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Step 1.3: Mapbox public token（pk. 开头）
mapboxgl.accessToken =
  'pk.eyJ1Ijoiaml3Mjk0IiwiYSI6ImNtd2N4NWF4ajA2azMyem9zb3IzYTN4YXgifQ.kIgR_eqUb6QMXSvqockw8Q';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027], // [经度, 纬度]，MIT 附近
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// 课程网站上的数据副本（如果打不开，换成 https://dsc106.com/labs/lab07/data/）
const DATA_URL = 'https://dsc-courses.github.io/dsc209r-2026-fa/labs/lab07/data/';

// ================= 全局 helper 函数 =================

// Step 5.4: 1440 个"分钟桶"，每个桶放那一分钟出发/到达的骑行
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Step 3.3: 经纬度 -> 屏幕像素坐标（会自动考虑拖动、缩放）
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Step 5.2: 分钟数 -> "8:30 AM" 这样的格式
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Step 5.3: 一个 Date 是午夜后的第几分钟
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Step 5.4: 只取选定时间前后 60 分钟的桶（处理跨午夜的情况）
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // 不筛选，返回全部
  }

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Step 4.2 + 5.3 + 5.4: 算每个站的到达、出发、总流量
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Step 6.1: 出发占比 -> 0 / 0.5 / 1 三档
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

function departureRatio(d) {
  // 流量为 0 时避免 0/0 = NaN
  return d.totalTraffic === 0 ? 0.5 : stationFlow(d.departures / d.totalTraffic);
}

// Step 4.4: tooltip 文字
function tooltipText(d) {
  return `${d.name}\n${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`;
}

// Step 2.3 Going Further: 自行车道样式只写一次，两个城市共用
const bikeLaneStyle = {
  'line-color': '#32D400',
  'line-width': 3,
  'line-opacity': 0.5,
};

// ================= 地图加载完再画数据 =================
map.on('load', async () => {
  // ---------- Step 2: 自行车道 ----------
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: { ...bikeLaneStyle },
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: { ...bikeLaneStyle },
  });

  // ---------- Step 3.1: 站点 JSON ----------
  let jsonData;
  try {
    // 注意：这里不能再写 const，否则外面的 jsonData 还是 undefined
    jsonData = await d3.json(DATA_URL + 'bluebikes-stations.json');
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }

  // ---------- Step 4.1 + 5.3 + 5.4: 骑行 CSV，读的时候顺便放进分钟桶 ----------
  await d3.csv(DATA_URL + 'bluebikes-traffic-2024-03.csv', (trip) => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);

    departuresByMinute[minutesSinceMidnight(trip.started_at)].push(trip);
    arrivalsByMinute[minutesSinceMidnight(trip.ended_at)].push(trip);

    return trip;
  });

  const stations = computeStationTraffic(jsonData.data.stations);
  console.log('Stations Array:', stations);

  // ---------- Step 4.3: 圆的面积和流量成正比，所以用 scaleSqrt ----------
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // ---------- Step 3.3: 在 svg 上画圆 ----------
  const svg = d3.select('#map').select('svg');

  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name) // key：让 D3 记住哪个圆是哪个站
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', departureRatio)
    .each(function (d) {
      d3.select(this).append('title').text(tooltipText(d));
    });

  // 地图一动就重新算圆的位置
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // ---------- Step 5.2: 滑块 ----------
  // 注意：getElementById 里不要带 #
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // ---------- Step 5.3: 按时间筛选后更新圆的大小、颜色、tooltip ----------
  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);

    // 筛选后数据少了，把圆放大一点
    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', departureRatio);

    circles.select('title').text(tooltipText);
  }

  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
