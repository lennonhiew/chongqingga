// Starter trip plan (editable later in the admin app). Places are linked to poll options by name,
// so the Plan page can show their photo and how many people voted for them.
// Prices: Trip.com, 16 Nov 2026, tax included, FPX price. Trains are estimates.

export function buildPlan(options = [], polls = []) {
  const opt = (name) => options.find((o) => o.name === name)?.id || "";
  const pollId = (title) => polls.find((p) => p.title === title)?.id || "";
  let n = 0;
  const id = (p) => `${p}${(++n).toString(36)}`;
  const place = (time, name, groups) => ({ id: id("i"), time, kind: "place", text: name, optionId: opt(name), groups });
  const item = (time, kind, text, groups) => ({ id: id("i"), time, kind, text, groups });

  return {
    rmPerNight: 80,
    foodRmPerDay: 90,
    groups: [
      {
        id: "ly", name: "Leon & YJ", members: ["Leon", "YJ"], nights: 9, days: 9,
        note: "Hotel nights: 19 Dec in Hangzhou, then 28 Dec – 4 Jan. The camp covers 20–27 Dec.",
        stays: [
          { from: "2026-12-19", to: "2026-12-27", place: "Zhejiang camp", color: "camp" },
          { from: "2026-12-28", to: "2027-01-01", place: "Chongqing", color: "cq" },
          { from: "2027-01-02", to: "2027-01-05", place: "Chengdu", color: "cd" },
        ],
      },
      {
        id: "f4", name: "The other 4", members: ["Yong Zheng", "Greatt", "Suishern", "Derek"], nights: 7, days: 7,
        note: "Hotel nights: 29 Dec – 4 Jan.",
        stays: [
          { from: "2026-12-29", to: "2026-12-29", place: "Chengdu", color: "cd" },
          { from: "2026-12-30", to: "2027-01-01", place: "Chongqing", color: "cq" },
          { from: "2027-01-02", to: "2027-01-05", place: "Chengdu", color: "cd" },
        ],
      },
    ],
    trips: [
      { id: id("t"), kind: "flight", groups: ["ly"], date: "2026-12-19", carrier: "AirAsia X", no: "D7 306", from: "KUL", fromCity: "Kuala Lumpur", to: "HGH", toCity: "Hangzhou", dep: "17:00", arr: "22:25", plusDays: 0, rmEach: 907, bag: "One 20 kg bag shared by the 2", status: "planned", note: "Book as 2 tickets: one with 20 kg (RM 1,002) and one without (RM 812)." },
      { id: id("t"), kind: "flight", groups: ["ly"], date: "2026-12-28", carrier: "China United Airlines", no: "", from: "WNZ", fromCity: "Wenzhou", to: "CKG", toCity: "Chongqing", dep: "07:50", arr: "10:55", plusDays: 0, rmEach: 407, bag: "20 kg each", status: "planned", note: "" },
      { id: id("t"), kind: "flight", groups: ["f4"], date: "2026-12-29", carrier: "Air China", no: "", from: "KUL", fromCity: "Kuala Lumpur", to: "TFU", toCity: "Chengdu", dep: "18:45", arr: "23:15", plusDays: 0, rmEach: 685, bag: "23 kg each", status: "planned", note: "Lands late: take a Didi to the hotel." },
      { id: id("t"), kind: "train", groups: ["f4"], date: "2026-12-30", carrier: "Bullet train", no: "", from: "CDE", fromCity: "Chengdu East", to: "CQN", toCity: "Chongqing", dep: "09:00", arr: "10:30", plusDays: 0, rmEach: 75, bag: "", status: "planned", note: "Second class, about ¥96–154. Book on Trip.com with your passport." },
      { id: id("t"), kind: "train", groups: ["all"], date: "2027-01-02", carrier: "Bullet train", no: "", from: "CQN", fromCity: "Chongqing", to: "CDE", toCity: "Chengdu East", dep: "10:00", arr: "11:30", plusDays: 0, rmEach: 75, bag: "", status: "planned", note: "Second class, about ¥96–154." },
      { id: id("t"), kind: "flight", groups: ["all"], date: "2027-01-05", carrier: "AirAsia X", no: "D7 327", from: "TFU", fromCity: "Chengdu", to: "KUL", toCity: "Kuala Lumpur", dep: "23:55", arr: "04:50", plusDays: 1, rmEach: 640, bag: "One 20 kg bag per 2 people", status: "planned", note: "Book as 3 tickets with 20 kg (RM 690) and 3 without (RM 589)." },
    ],
    days: [
      { id: id("d"), date: "2026-12-19", city: "Hangzhou", title: "Leon & YJ fly out", groups: ["ly"], items: [
        item("17:00", "flight", "Fly KL → Hangzhou, land 22:25"),
        item("23:30", "hotel", "One night near the city before camp"),
      ] },
      { id: id("d"), date: "2026-12-20", endDate: "2026-12-27", city: "Zhejiang", title: "Winter camp", groups: ["ly"], items: [
        item("20 Dec", "note", "Check in at camp, Hangzhou"),
        item("23 Dec", "train", "Camp moves to Yiwu"),
        item("25 Dec", "train", "Camp moves to Wenzhou"),
        item("27 Dec", "note", "Closing ceremony in Wenzhou"),
      ] },
      { id: id("d"), date: "2026-12-28", city: "Chongqing", title: "Leon & YJ land in Chongqing", groups: ["ly"], items: [
        item("07:50", "flight", "Fly Wenzhou → Chongqing, land 10:55"),
        place("Afternoon", "Liziba monorail"),
        place("Night", "Jiefangbei & Bayi food street"),
      ] },
      { id: id("d"), date: "2026-12-29", city: "Chongqing · Chengdu", title: "The others fly in", items: [
        place("Morning", "Ciqikou old town", ["ly"]),
        place("Afternoon", "Eling Erchang", ["ly"]),
        place("Evening", "Shibati", ["ly"]),
        item("18:45", "flight", "Fly KL → Chengdu, land 23:15", ["f4"]),
        item("23:45", "hotel", "Hotel near Chengdu East station", ["f4"]),
      ] },
      { id: id("d"), date: "2026-12-30", city: "Chongqing", title: "Everyone together", items: [
        item("09:00", "train", "Bullet train Chengdu → Chongqing", ["f4"]),
        item("12:00", "note", "Meet at the hotel"),
        place("Sunset", "Raffles City sky deck"),
        place("Night", "Hongyadong"),
      ] },
      { id: id("d"), date: "2026-12-31", city: "Chongqing", title: "New Year's Eve", items: [
        place("Morning", "Yangtze River Cableway"),
        place("Afternoon", "Kuixing Building"),
        place("Evening", "Two Rivers night cruise"),
        item("23:30", "note", "Countdown at Jiefangbei (very crowded)"),
      ] },
      { id: id("d"), date: "2027-01-01", city: "Chongqing", title: "Hotpot and the view", items: [
        item("Morning", "note", "Sleep in after the countdown"),
        place("Dinner", "Hotpot night"),
        place("Night", "Nanshan Yikeshu lookout"),
      ] },
      { id: id("d"), date: "2027-01-02", city: "Chengdu", title: "Back to Chengdu", items: [
        item("10:00", "train", "Bullet train Chongqing → Chengdu"),
        place("Afternoon", "Kuanzhai Xiangzi"),
        place("Night", "Chunxi Road & Taikoo Li"),
      ] },
      { id: id("d"), date: "2027-01-03", city: "Chengdu", title: "Old Chengdu", items: [
        place("Morning", "People's Park teahouse"),
        place("Morning", "Wenshu Monastery"),
        place("Afternoon", "Wuhou Shrine"),
        place("Evening", "Jinli old street"),
        place("Night", "Sichuan opera face-changing"),
      ] },
      { id: id("d"), date: "2027-01-04", city: "Chengdu", title: "Day trip", items: [
        { id: id("i"), time: "All day", kind: "vote", text: "Whatever wins the Day trip vote", pollId: pollId("Day trip") },
        place("Late night", "Jiuyanqiao bar street"),
      ] },
      { id: id("d"), date: "2027-01-05", city: "Chengdu", title: "Pandas, then home", items: [
        place("07:30", "Giant Panda Base"),
        item("Afternoon", "food", "Last 串串 and packing"),
        item("21:30", "note", "Leave for Tianfu airport"),
        item("23:55", "flight", "Fly Chengdu → KL, land 04:50 on 6 Jan"),
      ] },
    ],
  };
}
