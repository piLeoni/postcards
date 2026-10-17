title("Label fonts demo")

output({
  width: "220mm",
  height: "160mm",
  scale: "1:1",
  projection: "webmercator",
  tileZoom: 14,
  lat: 41.01,
  lng: 28.98,
})

const labelStroke = { style: "solid", width: "0.22mm", color: "#111111" }

// 1. Built-in Hershey futural + universal fallback (Greek / Cyrillic / CJK -> Latin)
const row1 = lines.text({
  text: "futural: Zürich · Αθήνα · Москва · 東京",
  font: "futural",
  at: ["50%", "14%"],
  size: "4.5mm",
})

// 2. EMS Readability: Turkish & Extended Latin with native accents (İ, ğ, ı, ş, ö, ç, ü, ß, æ)
const row2 = lines.text({
  text: "ems-readability: İstanbul · Şişli · ğışöçü · Straße",
  font: "ems-readability",
  at: ["50%", "31%"],
  size: "4.5mm",
})

// 3. EMS Osmotron: geometric sci-fi single-line font + fallback on Greek
const row3 = lines.text({
  text: "ems-osmotron: Beyoğlu 123 · Θεσσαλονίκη",
  font: "ems-osmotron",
  at: ["50%", "48%"],
  size: "4.5mm",
})

// 4. Hershey Gothic English: blackletter multi-stroke single-line font
const row4 = lines.text({
  text: "hershey-goth-english: Kadıköy & Karaköy",
  font: "hershey-goth-english",
  at: ["50%", "65%"],
  size: "5.2mm",
})

// 5. Direct custom URL (`origin: "stroke"`) loading EMS Swiss script font
const row5 = lines.text({
  text: "stroke url (EMSSwiss): Bosphorus & Golden Horn",
  font: {
    origin: "stroke",
    url: "https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSSwiss.svg",
  },
  at: ["50%", "83%"],
  size: "4.6mm",
})

draw({ id: "row1", from: row1, stroke: labelStroke })
draw({ id: "row2", from: row2, stroke: labelStroke })
draw({ id: "row3", from: row3, stroke: labelStroke })
draw({ id: "row4", from: row4, stroke: labelStroke })
draw({ id: "row5", from: row5, stroke: labelStroke })
