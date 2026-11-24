"use strict";

const degreesToRadians = Math.PI / 180;

function globeSolarPosition(now) {
  // NOAA fractional-year equations for solar declination and the equation of time.
  const year = new Date(now).getUTCFullYear();
  const yearStart = Date.UTC(year,0,1);
  const day = 86400000;
  const daysInYear = (Date.UTC(year+1,0,1)-yearStart)/day;
  const gamma = 2*Math.PI*((now-yearStart)/day-.5)/daysInYear;
  const equation = 229.18*(.000075+.001868*Math.cos(gamma)-.032077*Math.sin(gamma)
    -.014615*Math.cos(2*gamma)-.040849*Math.sin(2*gamma));
  const declination = .006918-.399912*Math.cos(gamma)+.070257*Math.sin(gamma)
    -.006758*Math.cos(2*gamma)+.000907*Math.sin(2*gamma)-.002697*Math.cos(3*gamma)+.00148*Math.sin(3*gamma);
  const longitude = 180-((now%day+day)%day/60000+equation)/4;
  return {declination,longitude};
}

function globeTerminatorPath({declination,longitude}, project) {
  const slope = Math.tan(declination) || 1e-9;
  const longitudes = new Set(Array.from({length:181},(_,i)=>i*2-180));
  // Add points near the equatorial crossings so the steep equinox curves stay smooth.
  for (const crossing of [longitude-90,longitude+90]) {
    for (const offset of [-1,-.2,-.04,-.008,0,.008,.04,.2,1]) {
      longitudes.add(((crossing+offset+180)%360+360)%360-180);
    }
  }
  const points = [...longitudes].sort((a,b)=>a-b).map(lon=>{
    const latitude = Math.atan(-Math.cos((lon-longitude)*degreesToRadians)/slope)/degreesToRadians;
    return project(lon,latitude).map(n=>n.toFixed(2)).join(",");
  });
  return "M"+points.join("L");
}

// Minutes since local midnight for usual main sessions. Dated provider hours take precedence.
const globeMarketHours = {
  US:{zone:"America/New_York",hours:[570,960]},
  CN:{zone:"Asia/Shanghai",hours:[570,900],break:[690,780]},
  HK:{zone:"Asia/Hong_Kong",hours:[570,960],break:[720,780]},
  SG:{zone:"Asia/Singapore",hours:[540,1020],break:[720,780]},
  JP:{zone:"Asia/Tokyo",hours:[540,930],break:[690,750]},
  KR:{zone:"Asia/Seoul",hours:[540,930]},
  ID:{zone:"Asia/Jakarta",hours:[540,960],break:[720,810],fridayBreak:[690,840]},
  SA:{zone:"Asia/Riyadh",hours:[600,900],sunToThu:true},
  EG:{zone:"Africa/Cairo",hours:[600,870],sunToThu:true},
  ZA:{zone:"Africa/Johannesburg",hours:[540,1020]},
  RU:{zone:"Europe/Moscow",hours:[600,1120]},
};
const globeMarketFormatters = new Map();

function globeMarketTime(at, zone) {
  if (!zone || !Number.isFinite(at)) return null;
  let formatter = globeMarketFormatters.get(zone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA",{timeZone:zone,weekday:"short",year:"numeric",month:"2-digit",day:"2-digit",
        hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
    } catch {return null;}
    globeMarketFormatters.set(zone,formatter);
  }
  const {weekday,year,month,day,hour,minute} = Object.fromEntries(formatter.formatToParts(at).map(part=>[part.type,part.value]));
  return {weekday,date:year+"-"+month+"-"+day,minutes:Number(hour)*60+Number(minute),clock:hour+":"+minute};
}

function globeMarketStatus(country, reading, now, checkedOnline = false) {
  const standard = globeMarketHours[country];
  const zone = reading?.timezone || standard?.zone;
  const local = globeMarketTime(now,zone);
  const result = (state,label) => ({state,label,clock:local?.clock});
  if (!local) return result("unknown","时段待确认");
  const afterSession = () => {
    const quoteDate = reading?.observationDate ?? globeMarketTime(reading?.time,zone)?.date;
    return result("closed",quoteDate===local.date ? "已收盘" : "休市");
  };
  const tradingDay = standard?.sunToThu ? !["Fri","Sat"].includes(local.weekday) : !["Sat","Sun"].includes(local.weekday);
  if (!tradingDay) return result("closed","休市");

  const start = globeMarketTime(reading?.sessionStart,zone), end = globeMarketTime(reading?.sessionEnd,zone);
  const validPeriod = start && end && start.date===end.date && start.minutes<end.minutes;
  if (checkedOnline && validPeriod && start.date>local.date) return afterSession();
  const datedPeriod = validPeriod && start.date===local.date;
  const hours = datedPeriod ? [start.minutes,end.minutes] : standard?.hours ?? (validPeriod ? [start.minutes,end.minutes] : null);
  if (!hours) return result("unknown","时段待确认");
  const [opens,closes] = hours;
  if (local.minutes<opens) return result("closed","休市");
  if (local.minutes>=closes) return afterSession();

  const midday = local.weekday==="Fri" && standard?.fridayBreak ? standard.fridayBreak : standard?.break;
  if (midday && local.minutes>=midday[0] && local.minutes<midday[1]) return result("closed","午休");
  return result("open","交易中");
}
