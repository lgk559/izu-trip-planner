-- ============================================================
-- Phase 1 資料匯入：把 itinerary-data.json 轉成 INSERT
-- 純資料，不需 service_role。整份貼進 SQL Editor → Run 即可。
-- 需在 0001_phase1_schema.sql 執行成功後才能跑。
--
-- 作法：用 CTE 產生各層 id，再串接子資料，避免手動貼死 uuid。
-- detail 內的單引號一律用兩個單引號跳脫。
--
-- 可重入性：這份 seed 沒有 if not exists 判斷，重複執行會插入重複的 trip。
-- 若要重匯，先手動 `truncate public.trips cascade;`（cascade 會連帶清掉
-- days/stops/images）再跑一次。
-- ============================================================

do $$
declare
  v_trip_id uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid;   -- 四天的 day id
  s  uuid;                               -- 逐個 stop 重複使用
begin
  -- ---------- trips ----------
  insert into public.trips (name) values ('伊豆半島 × 河口湖') returning id into v_trip_id;

  -- ==================== Day 1（10/8 四）====================
  insert into public.days (trip_id, date_label, weekday, route, meals, hotel, sort_order)
  values (
    v_trip_id, '10/8', '四',
    '東京 → 伊豆高原（大室山・豪華露營）',
    jsonb_build_object(
      'breakfast', '尚未安排（視航班而定）',
      'lunch', '自理／建議東京車站採買便當',
      'dinner', '露營地內晚餐（依訂購方案而定，需另行確認是否含BBQ晚餐）'
    ),
    jsonb_build_object(
      'name', '伊豆グランヴィレッジ IZU GRAN VILLAGE Glamping',
      'address', '靜岡縣伊東市富戶1089-4',
      'url', 'https://id-village.jp/granvillage/',
      'note', '入住10/8一晚，Check-in 15:00／Check-out 11:00，緊鄰伊豆Granpal公園，電話0557-52-3714'
    ),
    1
  ) returning id into d1;

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d1, '09:XX', '抵達成田機場', '交通', '確定航班時刻後回填實際降落時間',
     '降落成田機場後，護照查驗＋提領行李＋海關，國際線建議抓60-90分鐘緩衝（旺季或多航班同時抵達可能更久）。實際降落時間確定後，請回填此欄並重新核對後續轉乘時間。', 1) returning id into s;

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d1, '約11:00', '成田機場 → 東京／品川站', '交通', '搭成田エクスプレス（N''EX），全車指定席',
     '搭乘JR成田エクスプレス（N''EX）前往東京駅或品川駅：成田→東京約60分（單程3,070円，えきねっと早特約2,460円），成田→品川約70-80分（約3,250-3,330円）。全車指定席，班次約每30-60分鐘一班（05:00-23:00間運行），建議事先在えきねっと訂位。若後續踊り子從品川出發，可直接搭續開往品川方向的N''EX車次，省去東京駅內轉乘。', 2) returning id into s;
  insert into public.images (stop_id, url, caption, sort_order) values
    (s, 'https://www.jreast.co.jp/multi/traininformation/odoriko/img/mv_pc.jpg', '成田エクスプレス', 1);

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d1, '約12:30', '東京／品川站 → 伊豆高原站', '交通', '轉乘特急「踊り子」，全車指定席，車程約2小時',
     '轉乘JR特急「踊り子」直達伊豆高原駅，不需中途換車，車程約1小時50分-2小時，東京→伊豆高原總額5,550円（普通車指定席）。全車指定席，需事先於えきねっと或窗口訂位（開賣時間為乘車日1個月前上午10:00，建議一開賣就搶）。若時段搭得上，另有「サフィール踊り子」（僅東京11:00發一班，綠色車廂7,080円起，較舒適但班次固定），因抵達時間較晚通常搭不上。', 3) returning id into s;

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d1, '約14:20', '伊豆高原站抵達', '交通', '寄放行李，飯店在八幡野區',
     '<a href=''https://www.booking.com/hotel/jp/izu-kogen-ocean-resort-ito-villa-toki.zh-tw.html''>リゾートホテル伊東山荘-Toki-</a>位於八幡野，距伊豆高原駅約10-15分鐘車程。因抵達時間已偏晚，行李可直接帶往飯店，或先寄放車站置物櫃輕裝去大室山。', 4) returning id into s;

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d1, '15:00', '大室山纜車', '下車參觀', '360度火山口景觀，秋天芒草季很美',
     '伊豆高原駅搭東海巴士約15分鐘可達纜車站。纜車單程約6分鐘，山頂沿火山口步道繞一圈約30分鐘可走完，天氣好時可遠眺伊豆七島。', 5) returning id into s;
  insert into public.images (stop_id, url, caption, sort_order) values
    (s, 'https://hiyori.cc/wp/wp-content/uploads/2020/01/DSCF0176-1.jpg', '山腳下乘車地方和商店', 1),
    (s, 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_Q-iPYfMclbun-_JdVTz07UUs9YMLUZozLoeAIGAsRA&s=10', '大室山景觀', 2),
    (s, 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTtqaI_v4e7kljlg8s8g6gfxH6NQj3Ss8TwndMVFPI_PjZpuR9MUXTY9LIJ&s=10', '大室山纜車', 3),
    (s, 'https://i0.wp.com/rj-travel-life.com/wp-content/uploads/2021/09/IMG_1464-1.jpg?resize=1536%2C1023&ssl=1', '火山口遊步道', 4),
    (s, 'https://i0.wp.com/rj-travel-life.com/wp-content/uploads/2021/09/IMG_1457-1.jpg?resize=1536%2C1024&ssl=1', '深70公尺的大坑（火山口）現在是射箭場', 5);

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d1, '17:00', '入住 伊豆グランヴィレッジ', '住宿', '豪華露營check-in，晚餐視方案而定',
     '大室山纜車站開車到伊豆グランヴィレッジ僅約3分鐘，緊鄰伊豆Granpal公園，交通非常方便。Check-in時間至21:00皆有夜間staff可辦理，不用擔心大室山逛太晚趕不上。晚餐依訂購方案而定，需另行確認是否含BBQ或需自理。', 6) returning id into s;

  -- ==================== Day 2（10/9 五）====================
  insert into public.days (trip_id, date_label, weekday, route, meals, hotel, sort_order)
  values (
    v_trip_id, '10/9', '五',
    '伊豆グランヴィレッジ → 伊豆Granpal公園・城崎海岸 → 伊東山荘',
    jsonb_build_object(
      'breakfast', '露營地內早餐（依方案確認）',
      'lunch', '伊豆Granpal公園內或周邊自理',
      'dinner', '飯店內晚餐'
    ),
    jsonb_build_object(
      'name', 'リゾートホテル伊東山荘-Toki',
      'address', '靜岡縣伊東市八幡野1084-74',
      'url', '',
      'note', '入住10/9一晚，隔天10/10前往御殿場方向，不續住'
    ),
    2
  ) returning id into d2;

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d2, '上午', '露營地退房', '住宿', 'Check-out 11:00前，行李可先寄放',
     '伊豆グランヴィレッジ退房時間為11:00，行李可請櫃檯協助暫存，輕裝直接步行至正對面的伊豆Granpal公園。', 1) returning id into s;

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d2, '11:00', '伊豆Granpal公園', '入內參觀', '摩天輪、花園、水豚，門票制主題樂園',
     '就在伊豆グランヴィレッジ正對面，門票制的大型休閒公園，有摩天輪、溜滑梯、花園造景與水豚等動物互動設施，適合悠閒遊玩約2-3小時，園內也有餐廳可解決午餐。', 2) returning id into s;
  insert into public.images (stop_id, url, caption, sort_order) values
    (s, 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRpS1GHzdGt52M_UIhnrpS2rngb79LsllUYbqsM6JWnwQ&s=10', '互動設施', 1),
    (s, 'https://www.princehotels.com/kawana/wp-content/uploads/sites/39/2021/05/loc_izugranpal_menu.jpg', '互動設施', 2);

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d2, '14:00', '城崎海岸散策', '下車參觀', '吊橋、火山熔岩海岸線，輕健行',
     '從伊豆Granpal公園搭巴士或計程車約15分鐘至門脇吊橋一帶，沿海岸步道散步約1小時，沿途有咖啡廳可稍作休息。', 3) returning id into s;
  insert into public.images (stop_id, url, caption, sort_order) values
    (s, 'https://img.cooljapan-videos.com/r/1000x666/files/article_images/fc8e2de778d865d15a249c9be14fd399.jpg.webp', '門脇吊橋', 1),
    (s, 'https://lh3.googleusercontent.com/gps-cs-s/AHRPTWkrY1KHcCJEyMXWl5M7Bi1NoHtGxw_sYgMqQ4ExQuMgYRvaIOPFfTp-MWJXPnYIh-Ths24_aup8mqAnJ5PIJGAaftnIwNtmwc8C8ahEJY44-FR4y-3j74r9aYovJQ8DuipSpF21=s1360-w1360-h1020-rw', '門脇吊橋', 2);

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d2, '16:30', '入住 伊東山荘-Toki', '住宿', 'check-in，晚餐飯店內用',
     '從城崎海岸返回八幡野約15-20分鐘車程，可回飯店泡湯放鬆，晚餐在飯店內享用，結束第二天行程。', 4) returning id into s;
  insert into public.images (stop_id, url, caption, sort_order) values
    (s, 'https://cf.bstatic.com/xdata/images/hotel/square600/803935059.webp?k=f2ea8b7ad6643b61756730f0337381d6ac9cce8f22a71072e2050909a8ba5760&o=', 'リゾートホテル伊東山荘', 1);

  -- ==================== Day 3（10/10 六）====================
  insert into public.days (trip_id, date_label, weekday, route, meals, hotel, sort_order)
  values (
    v_trip_id, '10/10', '六',
    '伊東 → 御殿場（富士サファリパーク）',
    jsonb_build_object(
      'breakfast', '飯店內早餐',
      'lunch', 'サファリパーク園內自理',
      'dinner', '時之栖園區內晚餐（精釀啤酒、溶岩窯烤披薩）'
    ),
    jsonb_build_object(
      'name', '御殿場高原 時之栖（御殿場高原ホテル／ホテル時之栖，依預算選擇）',
      'address', '靜岡縣御殿場市神山719',
      'url', '',
      'note', '入住10/10一晚，園區內含溫泉、精釀啤酒廠直營餐廳，實際訂哪一棟需另外比價'
    ),
    3
  ) returning id into d3;

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d3, '09:00', '退房，移動至御殿場', '交通', '經熱海、三島轉JR御殿場線，約2小時',
     '伊豆高原駅退房後，搭伊豆急行線至熱海駅（約45-50分鐘），轉JR東海道線至三島或沼津，再轉JR御殿場線至御殿場駅，全程約1小時50分-2小時、需1-2次轉乘。這段以移動為主，不特別安排熱海景點，建議轉乘時間抓寬鬆一點。', 1) returning id into s;

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d3, '約12:00', '富士サファリパーク', '入內參觀', '開車進猛獸區＋步行區，近距離看動物',
     '御殿場駅有接駁巴士可達，或園區周邊可租車自駕進猛獸區（不開車也可搭乘園內周遊巴士）。建議安排2.5-3小時，猛獸區＋步行區＋餵食體驗都走過，園內有餐廳可解決午餐。', 2) returning id into s;
  insert into public.images (stop_id, url, caption, sort_order) values
    (s, 'https://curly.com.tw/wp-content/uploads/2023/09/P1033711.jpg', '富士野生動物園', 1),
    (s, 'https://curly.com.tw/wp-content/uploads/2023/09/P1033476.jpg', '超級叢林巴士', 2),
    (s, 'https://www.fujisafari.co.jp/wp-content/themes/fuji-safari/images/common/language/detail/img_01-03.jpg', '野生動物區導航車', 3),
    (s, 'https://www.fujisafari.co.jp/wp-content/themes/fuji-safari/images/common/language/detail/img_01-04.jpg', '徒步旅行', 4);

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d3, '約16:00', '入住 時之栖', '住宿', 'check-in，晚上泡湯、逛精釀啤酒廠',
     '從富士サファリパーク到時之栖車程約20-25分鐘（估算值，建議訂房後跟飯店確認接駁或計程車安排）。入住後可到園區內溫泉放鬆，晚餐選精釀啤酒廠直營餐廳的溶岩窯烤披薩或御殿場高原啤酒，結束第三天行程。', 3) returning id into s;

  -- ==================== Day 4（10/11 日）====================
  insert into public.days (trip_id, date_label, weekday, route, meals, hotel, sort_order)
  values (
    v_trip_id, '10/11', '日',
    '御殿場 → 東京 → 成田機場（賦歸）',
    jsonb_build_object(
      'breakfast', '時之栖園區內早餐',
      'lunch', '移動途中自理（高速巴士站、新宿或機場內用餐）',
      'dinner', '視航班安排'
    ),
    jsonb_build_object(
      'name', '—',
      'address', '本日退房，無住宿',
      'url', '',
      'note', ''
    ),
    4
  ) returning id into d4;

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d4, '08:30', '退房，御殿場Premium Outlet', '入內參觀', '時之栖車程約20分鐘，快速採購',
     '時之栖到Outlet平日車程約20分鐘（假日或特賣期可能超過1小時，需留意）。因回程班機時間還沒確定（下午14-17點區間），這站建議先抓1-1.5小時快速逛，若確定航班偏14點就直接省略此站、提早出發。', 1) returning id into s;

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d4, '約10:30', '御殿場站出發 → 新宿／東京', '交通', '優先搭高速巴士直達新宿，不需轉車',
     '御殿場駅搭高速巴士（御殿場・新宿線）直達新宿駅，約1小時35分鐘、無需轉乘，班次比電車單純好抓。也可搭JR御殿場線經国府津轉東海道線到東京駅，約2小時5分、需轉乘1次、車資1,980円，但巴士通常更省事。', 2) returning id into s;

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d4, '約12:15', '新宿／東京 → 成田機場', '交通', '轉乘成田エクスプレス（N''EX）',
     '轉乘JR成田エクスプレス（N''EX）直達成田機場，新宿發車約80-90分鐘、東京發車約60分鐘，全車指定席，建議事先於えきねっと訂位。', 3) returning id into s;

  insert into public.stops (day_id, time, name, tag, summary, detail, sort_order) values
    (d4, '約13:30-14:00', '抵達成田機場', '交通', '辦理登機手續、安檢，回程班機約下午14-17點起飛',
     '目前回程班機時間僅抓下午14-17點區間，國際線建議提早2-2.5小時抵達機場辦理登機與安檢。實際航班時間確定後，請回頭校準本日Outlet停留時間與出發時刻，若班機偏17點，Outlet可以逛久一點；若偏14點，建議Outlet直接省略、退房後直奔御殿場站。', 4) returning id into s;

end $$;
