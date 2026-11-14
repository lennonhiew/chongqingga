// First-run data: the trip, the six friends and the places from the itinerary.
// Prices are per person in yuan (Trip.com / official prices, Nov 2026; "est" = my estimate).

let n = 0;
const id = (p) => `${p}${(++n).toString(36)}`;

const poll = (title, subtitle, multi, options) => {
  const pollId = id("p");
  return {
    poll: { id: pollId, title, subtitle, multi },
    options: options.map(([emoji, name, zh, when, priceCny, note]) => ({
      id: id("o"), pollId, emoji, name, zh, when, priceCny, note,
    })),
  };
};

const cq = poll("Chongqing", "30 Dec – 1 Jan. Tap every place you want to go.", true, [
  ["🏮", "Hongyadong", "洪崖洞", "night", 0, "Cliffside stilt houses lit up at night. Best photo from Qiansimen Bridge."],
  ["🍢", "Jiefangbei & Bayi food street", "解放碑 / 八一好吃街", "night", 0, "Downtown street food, 5 minutes from Hongyadong. Food not included."],
  ["🛳️", "Two Rivers night cruise", "两江游", "night", 138, "Boat where the Yangtze and Jialing meet, skyline lit up. Trip.com price."],
  ["🚡", "Yangtze River Cableway", "长江索道", "day", 20, "Cable car over the river. One way ¥20, return ¥30. Queues of 1–2 h, go early."],
  ["🚝", "Liziba monorail", "李子坝", "day", 2, "The train that runs through an apartment block. 30 minutes, metro fare."],
  ["🌉", "Raffles City sky deck", "来福士探索舱", "sunset", 145, "Glass sky bridge above the river junction. Trip.com price."],
  ["🏢", "Kuixing Building", "魁星楼", "day", 0, "Walk in at street level and you're on the 22nd floor."],
  ["🏭", "Eling Erchang", "鹅岭二厂", "day", 0, "Old print factory turned cafés, with a view over the city."],
  ["🪜", "Shibati", "十八梯", "sunset", 0, "Restored old staircase neighbourhood. Nice at dusk."],
  ["🏯", "Ciqikou old town", "磁器口", "morning", 0, "Old town snacks like 麻花. Packed by noon, so go early."],
  ["🌃", "Nanshan Yikeshu lookout", "南山一棵树", "night", 50, "Best night panorama of the city. About ¥30 entry plus a Didi up (est)."],
  ["⛰️", "Wulong Karst day trip", "武隆", "fullday", 300, "Giant natural bridges, 2.5 h each way. Rough estimate with transport."],
]);

const cd = poll("Chengdu", "29 Dec and 2 – 5 Jan. Tap every place you want to go.", true, [
  ["🐼", "Giant Panda Base", "大熊猫基地", "morning", 55, "Pandas are awake before 10 am. Book with your passport. Official price."],
  ["🍵", "People's Park teahouse", "人民公园鹤鸣茶社", "morning", 80, "Tea plus ear-cleaning, the Chengdu classic (est)."],
  ["🛕", "Wenshu Monastery", "文殊院", "morning", 0, "Quiet temple with a good vegetarian restaurant next door."],
  ["🏘️", "Kuanzhai Xiangzi", "宽窄巷子", "day", 0, "Old alleys, snacks and shops."],
  ["⛩️", "Wuhou Shrine", "武侯祠", "day", 50, "Three Kingdoms temple, right next to Jinli. Official price."],
  ["🏮", "Jinli old street", "锦里", "night", 0, "Red lanterns after dark. Do it straight after Wuhou Shrine."],
  ["🛍️", "Chunxi Road & Taikoo Li", "春熙路 / 太古里", "night", 0, "Shopping and the panda climbing the IFS building."],
  ["🎭", "Sichuan opera face-changing", "川剧变脸", "night", 148, "Shufeng Yayun show, about 1.5 h. Trip.com price."],
  ["🍻", "Jiuyanqiao bar street", "九眼桥", "latenight", 200, "Bars and clubs. Drinks budget (est)."],
]);

const trip = poll("Day trip", "Mon 4 Jan, from Chengdu. Pick one.", false, [
  ["🗿", "Leshan Giant Buddha", "乐山大佛", "fullday", 290, "1 h bullet train. Train ¥108 return + entry ¥80 + boat ¥70 + local transport."],
  ["🎭", "Sanxingdui Museum", "三星堆", "fullday", 130, "Strange 3,000-year-old bronze masks. Entry ¥72 + train and taxi."],
  ["🌊", "Dujiangyan + Mt Qingcheng", "都江堰 / 青城山", "fullday", 200, "Ancient irrigation works and a Taoist mountain (est)."],
  ["🛋️", "No day trip, chill in Chengdu", "", "day", 0, "Sleep in and eat more 串串."],
]);

export function seed() {
  const polls = [cq, cd, trip];
  const now = Date.now();
  return {
    settings: {
      tripName: "Chongqingga",
      dates: "29 Dec 2026 – 5 Jan 2027",
      rmPerCny: 0.61,
      flights: [
        { label: "Going", date: "Tue 29 Dec", from: "KUL", to: "TFU", dep: "15:20", arr: "19:30", no: "3U3996", dur: "4h 10m" },
        { label: "Coming home", date: "Tue 5 Jan", from: "TFU", to: "KUL", dep: "18:35", arr: "23:20", no: "3U3993", dur: "4h 45m" },
      ],
    },
    members: ["Leon", "YJ", "Yong Zheng", "Greatt", "Suishern", "Derek"].map((name) => ({
      id: id("m"), name, joinedAt: now, lastSeen: 0,
    })),
    polls: polls.map((p) => p.poll),
    options: polls.flatMap((p) => p.options),
    votes: [],
  };
}
