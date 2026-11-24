"use strict";

// Public issuer references. The first market is used for the holding's region.
globalThis.MARKET_ADR_REFERENCE = {
  HSBC: {
    source: "https://www.hsbc.com/investors/shareholder-and-dividend-information/investor-faqs",
    markets: [{country:"GB",symbol:"HSBA.L"},{country:"HK",symbol:"0005.HK"},{country:"BM",symbol:"HSBC.BH"}],
  },
  SMFG: {
    source: "https://www.smfg.co.jp/english/investor/faq/stock.html",
    markets: [{country:"JP",symbol:"8316.T"}],
  },
  TSM: {
    source: "https://investor.tsmc.com/english/faq",
    markets: [{country:"TW",symbol:"2330.TW"}],
  },
};
