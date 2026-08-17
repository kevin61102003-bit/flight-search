// 機場/城市清單，供出發地・目的地輸入的自動完成使用。
// 欄位：iata=主要機場/城市代碼、city=中文城市名(填入輸入框用，維持航線快取 key)、
//       country=國家/地區、alt=其他可搜尋關鍵字(英文、拼音、別名、其他機場碼)。
// 填入輸入框的值一律是 city(中文城市名)，下拉只是顯示 IATA + 完整地點幫你確認。
window.AIRPORTS = [
  // 台灣
  { iata: 'TPE', city: '臺北', country: '台灣', alt: 'taipei taibei 台北 桃園 松山 TSA taoyuan songshan' },
  { iata: 'TSA', city: '臺北松山', country: '台灣', alt: 'taipei songshan 松山 台北松山' },
  { iata: 'KHH', city: '高雄', country: '台灣', alt: 'kaohsiung gaoxiong 小港' },
  { iata: 'RMQ', city: '台中', country: '台灣', alt: 'taichung taizhong 臺中 清泉崗' },
  { iata: 'TNN', city: '台南', country: '台灣', alt: 'tainan 臺南' },
  { iata: 'HUN', city: '花蓮', country: '台灣', alt: 'hualien' },

  // 韓國
  { iata: 'ICN', city: '首爾', country: '韓國', alt: 'seoul incheon gimpo GMP 仁川 金浦' },
  { iata: 'PUS', city: '釜山', country: '韓國', alt: 'busan pusan 金海 gimhae' },
  { iata: 'CJU', city: '濟州', country: '韓國', alt: 'jeju cheju 済州 济州' },
  { iata: 'TAE', city: '大邱', country: '韓國', alt: 'daegu taegu' },

  // 日本
  { iata: 'TYO', city: '東京', country: '日本', alt: 'tokyo narita haneda NRT HND 成田 羽田' },
  { iata: 'OSA', city: '大阪', country: '日本', alt: 'osaka kansai itami KIX ITM 關西 关西 伊丹' },
  { iata: 'NGO', city: '名古屋', country: '日本', alt: 'nagoya chubu centrair 中部' },
  { iata: 'FUK', city: '福岡', country: '日本', alt: 'fukuoka' },
  { iata: 'CTS', city: '札幌', country: '日本', alt: 'sapporo chitose 千歲 新千歲 hokkaido 北海道' },
  { iata: 'OKA', city: '沖繩', country: '日本', alt: 'okinawa naha 那霸' },
  { iata: 'KIX', city: '大阪關西', country: '日本', alt: 'kansai kix osaka 關西 关西' },

  // 中國大陸・港澳
  { iata: 'HKG', city: '香港', country: '香港', alt: 'hong kong hongkong xianggang' },
  { iata: 'MFM', city: '澳門', country: '澳門', alt: 'macau macao aomen' },
  { iata: 'PVG', city: '上海', country: '中國', alt: 'shanghai pudong hongqiao SHA 浦東 虹橋' },
  { iata: 'PEK', city: '北京', country: '中國', alt: 'beijing daxing PKX 大興 首都' },
  { iata: 'CAN', city: '廣州', country: '中國', alt: 'guangzhou baiyun 广州' },
  { iata: 'SZX', city: '深圳', country: '中國', alt: 'shenzhen' },
  { iata: 'CTU', city: '成都', country: '中國', alt: 'chengdu tianfu TFU 天府' },
  { iata: 'XMN', city: '廈門', country: '中國', alt: 'xiamen 厦门' },

  // 東南亞
  { iata: 'SIN', city: '新加坡', country: '新加坡', alt: 'singapore changi 樟宜' },
  { iata: 'BKK', city: '曼谷', country: '泰國', alt: 'bangkok suvarnabhumi don mueang DMK 素萬那普 廊曼' },
  { iata: 'HKT', city: '普吉', country: '泰國', alt: 'phuket 普吉島' },
  { iata: 'KUL', city: '吉隆坡', country: '馬來西亞', alt: 'kuala lumpur' },
  { iata: 'CGK', city: '雅加達', country: '印尼', alt: 'jakarta soekarno' },
  { iata: 'DPS', city: '峇里島', country: '印尼', alt: 'bali denpasar 巴里島' },
  { iata: 'MNL', city: '馬尼拉', country: '菲律賓', alt: 'manila' },
  { iata: 'CEB', city: '宿霧', country: '菲律賓', alt: 'cebu' },
  { iata: 'SGN', city: '胡志明市', country: '越南', alt: 'ho chi minh saigon 西貢' },
  { iata: 'HAN', city: '河內', country: '越南', alt: 'hanoi' },
  { iata: 'DAD', city: '峴港', country: '越南', alt: 'da nang danang' },
  { iata: 'REP', city: '暹粒', country: '柬埔寨', alt: 'siem reap angkor 吳哥' },

  // 南亞・大洋洲
  { iata: 'DEL', city: '新德里', country: '印度', alt: 'delhi new delhi' },
  { iata: 'BOM', city: '孟買', country: '印度', alt: 'mumbai bombay' },
  { iata: 'SYD', city: '雪梨', country: '澳洲', alt: 'sydney 悉尼' },
  { iata: 'MEL', city: '墨爾本', country: '澳洲', alt: 'melbourne' },
  { iata: 'AKL', city: '奧克蘭', country: '紐西蘭', alt: 'auckland new zealand' },

  // 北美
  { iata: 'LAX', city: '洛杉磯', country: '美國', alt: 'los angeles la' },
  { iata: 'SFO', city: '舊金山', country: '美國', alt: 'san francisco 三藩市' },
  { iata: 'SEA', city: '西雅圖', country: '美國', alt: 'seattle' },
  { iata: 'JFK', city: '紐約', country: '美國', alt: 'new york newark EWR LGA 紐約甘迺迪' },
  { iata: 'YVR', city: '溫哥華', country: '加拿大', alt: 'vancouver' },
  { iata: 'YYZ', city: '多倫多', country: '加拿大', alt: 'toronto' },
  { iata: 'HNL', city: '檀香山', country: '美國', alt: 'honolulu hawaii 夏威夷 火奴魯魯' },
  { iata: 'GUM', city: '關島', country: '關島', alt: 'guam' },

  // 歐洲・中東
  { iata: 'LHR', city: '倫敦', country: '英國', alt: 'london heathrow gatwick LGW' },
  { iata: 'CDG', city: '巴黎', country: '法國', alt: 'paris charles de gaulle' },
  { iata: 'FRA', city: '法蘭克福', country: '德國', alt: 'frankfurt' },
  { iata: 'AMS', city: '阿姆斯特丹', country: '荷蘭', alt: 'amsterdam schiphol' },
  { iata: 'IST', city: '伊斯坦堡', country: '土耳其', alt: 'istanbul' },
  { iata: 'DXB', city: '杜拜', country: '阿聯', alt: 'dubai 迪拜' },
  { iata: 'DOH', city: '杜哈', country: '卡達', alt: 'doha qatar 多哈' },
];
