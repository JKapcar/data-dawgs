(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DDSummarize = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var GAME = {
    bozo: { label: "Bozo", href: "bozo.html" },
    draft: { label: "Auction draft", href: "draft-leagues.html" },
    auction: { label: "Auction draft", href: "draft-leagues.html" },
    guillotine: { label: "Guillotine", href: "guillotine.html" }
  };

  function dateValue(value) {
    var ms = typeof value === "number" ? value : Date.parse(value || "");
    return Number.isFinite(ms) ? ms : null;
  }

  function summarize(raw) {
    raw = raw || {};
    var rows = (Array.isArray(raw.leagues) ? raw.leagues : []).map(function (league) {
      var game = String(league.game || "").toLowerCase();
      var meta = GAME[game];
      if (!meta || league.member === false) return null;
      var settings = league.settings && typeof league.settings === "object" ? league.settings : {};
      var deadline = dateValue(settings.deadline || settings.closesAt || settings.draftAt);
      return {
        kind: "league",
        id: league.id,
        game: game,
        title: league.name || meta.label,
        href: settings.href || meta.href,
        deadline: deadline,
        status: settings.status || "Member",
        action: settings.action || "Nothing needs you right now.",
        actionLabel: settings.actionLabel || "Open",
        detail: settings.summary || (league.memberCount ? league.memberCount + " members" : "Your league membership")
      };
    }).filter(Boolean);

    if (raw.connector && raw.connector.active === true) {
      rows.push({
        kind: "connector",
        id: "connector",
        title: "Your AI connector",
        href: "signon.html#connect",
        deadline: null,
        status: "Active",
        action: "Your personal connector is active.",
        actionLabel: "Manage",
        detail: "Personal credential"
      });
    }

    rows.sort(function (a, b) {
      var ad = a.deadline == null ? Infinity : a.deadline;
      var bd = b.deadline == null ? Infinity : b.deadline;
      return ad - bd || a.title.localeCompare(b.title);
    });
    return rows;
  }

  return { summarize: summarize };
});
