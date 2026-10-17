import { Money } from "./money.js?v=34";
export const FinanceData = (() => {
  const EPOCH = "1970-01-01T00:00:00.000Z";
  const collections = ["accounts", "ops", "goals", "merchantRules"];
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const safeKey = (key) => !["__proto__", "prototype", "constructor"].includes(key);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const validStamp = (value) =>
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
  const clock = (value) =>
    Math.max(
      Date.parse(value?.updatedAt || EPOCH) || 0,
      Date.parse(value?.deletedAt || EPOCH) || 0,
    );
  const tick = (prior, now) => new Date(Math.max(Date.parse(now), clock(prior) + 1)).toISOString();
  function stableId(value) {
    let a = 2166136261,
      b = 5381;
    for (const char of String(value)) {
      a = Math.imul(a ^ char.charCodeAt(0), 16777619);
      b = Math.imul(b, 33) ^ char.charCodeAt(0);
    }
    return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
  }
  const live = (records) => (records || []).filter((record) => !record.deletedAt);
  function normalize(input, now = new Date().toISOString()) {
    const data = Money.migrate(input),
      markers = data.deletionMarkers || {};
    data.schemaVersion = 3;
    data.hasScreenshotImport = Boolean(
      data.hasScreenshotImport ||
      data.ops?.some((o) => o.sourceId || o.screenshotId || o.localScreenshot),
    );
    for (const type of collections) {
      const duplicate = new Map();
      markers[type] = { ...markers[type] };
      data[type] = (data[type] || [])
        .map((record) => {
          if (!record.id) {
            const identity =
              type === "merchantRules"
                ? record.key
                : [record.name, record.targetMinor, record.date].join("::");
            const ordinal = duplicate.get(identity) || 0;
            duplicate.set(identity, ordinal + 1);
            record.id =
              (type === "goals" ? "goal_" : "rule_") +
              stableId(identity) +
              (ordinal ? "_" + ordinal : "");
          }
          if (!record.updatedAt) record.updatedAt = EPOCH;
          const marker = own(markers[type], record.id) ? markers[type][record.id] : null;
          if (marker && Date.parse(marker) >= clock(record)) record.deletedAt = marker;
          if (record.deletedAt)
            markers[type][record.id] = new Date(
              Math.max(clock(record), Date.parse(markers[type][record.id] || EPOCH)),
            ).toISOString();
          return record;
        })
        .filter((record) => !record.deletedAt || Date.parse(now) - clock(record) <= 90 * 86400000);
    }
    data.deletionMarkers = markers;
    data.limits ||= {};
    data.budgetsByMonth ||= {};
    data.accountAliases ||= {};
    data.categories ||= [];
    for (const [field, meta] of [
      ["limits", "limitsMeta"],
      ["accountAliases", "accountAliasesMeta"],
      ["budgetsByMonth", "budgetsByMonthMeta"],
    ]) {
      data[meta] = { ...data[meta] };
      // Legacy key clocks are implicitly EPOCH; avoid inflating old documents.
      for (const [key, value] of Object.entries(data[meta]))
        if (value.deletedAt) delete data[field][key];
    }
    data.budgetLimitsMeta = { ...data.budgetLimitsMeta };
    for (const [month, limits] of Object.entries(data.budgetsByMonth)) {
      data.budgetLimitsMeta[month] = { ...data.budgetLimitsMeta[month] };
      // Per-category metadata is created when that key actually changes.
      for (const [key, meta] of Object.entries(data.budgetLimitsMeta[month]))
        if (meta.deletedAt) delete limits[key];
    }
    const accounts = new Set(live(data.accounts).map((record) => record.id));
    for (const operation of live(data.ops)) {
      if (
        !accounts.has(operation.account) ||
        (operation.type === "transfer" && !accounts.has(operation.to))
      )
        operation.needsAccountReview = true;
      else delete operation.needsAccountReview;
      if (operation.screenshotId && own(data.removedScreenshotIds, operation.screenshotId)) {
        delete operation.screenshotId;
        operation.screenshotUnavailable = true;
      }
    }
    return data;
  }
  function content(record) {
    const copy = { ...record };
    delete copy.updatedAt;
    return JSON.stringify(copy);
  }
  function stampMap(current, prior, currentMeta, priorMeta, now) {
    const metadata = { ...priorMeta, ...currentMeta };
    for (const key of new Set([...Object.keys(prior || {}), ...Object.keys(current || {})])) {
      if (!safeKey(key)) continue;
      if (
        own(current, key) === own(prior, key) &&
        JSON.stringify(current[key]) === JSON.stringify(prior[key])
      )
        continue;
      const time = tick(metadata[key], now);
      metadata[key] = own(current, key)
        ? { updatedAt: time }
        : { updatedAt: time, deletedAt: time };
    }
    return metadata;
  }
  function stamp(input, before, now = new Date().toISOString()) {
    const previous = normalize(before || { accounts: [], ops: [], goals: [], limits: {} }, now),
      desired = clone(input);
    // A user can explicitly create a previously removed key again. Strip only
    // the obsolete marker for a newly present value before canonicalisation.
    for (const [field, meta] of [
      ["limits", "limitsMeta"],
      ["accountAliases", "accountAliasesMeta"],
      ["budgetsByMonth", "budgetsByMonthMeta"],
    ]) {
      for (const key of Object.keys(desired[field] || {}))
        if (!own(previous[field], key) && desired[meta]?.[key]?.deletedAt)
          delete desired[meta][key];
    }
    for (const [month, limits] of Object.entries(desired.budgetsByMonth || {})) {
      const prior = previous.budgetsByMonth[month] || previous.limits;
      for (const key of Object.keys(limits))
        if (!own(prior, key) && desired.budgetLimitsMeta?.[month]?.[key]?.deletedAt)
          delete desired.budgetLimitsMeta[month][key];
    }
    const data = normalize(desired, now);
    for (const type of collections) {
      const prior = new Map(previous[type].map((record) => [record.id, record]));
      for (const record of data[type]) {
        const old = prior.get(record.id);
        if (!old || content(record) !== content(old)) {
          record.updatedAt = tick(old || record, now);
          if (record.deletedAt) record.deletedAt = record.updatedAt;
          else if (
            data.deletionMarkers[type][record.id] &&
            clock(record) > Date.parse(data.deletionMarkers[type][record.id])
          )
            delete data.deletionMarkers[type][record.id];
        }
        prior.delete(record.id);
      }
      for (const record of prior.values())
        if (!record.deletedAt) {
          const time = tick(record, now);
          data[type].push({ ...record, updatedAt: time, deletedAt: time });
        }
    }
    data.limitsMeta = stampMap(
      data.limits,
      previous.limits,
      data.limitsMeta,
      previous.limitsMeta,
      now,
    );
    data.accountAliasesMeta = stampMap(
      data.accountAliases,
      previous.accountAliases,
      data.accountAliasesMeta,
      previous.accountAliasesMeta,
      now,
    );
    data.budgetsByMonthMeta = stampMap(
      data.budgetsByMonth,
      previous.budgetsByMonth,
      data.budgetsByMonthMeta,
      previous.budgetsByMonthMeta,
      now,
    );
    for (const [month, limits] of Object.entries(data.budgetsByMonth))
      data.budgetLimitsMeta[month] = stampMap(
        limits,
        previous.budgetsByMonth[month] || previous.limits,
        data.budgetLimitsMeta[month],
        previous.budgetLimitsMeta[month] || previous.limitsMeta,
        now,
      );
    return normalize(data, now);
  }
  function mergeMap(remote, local, remoteMeta = {}, localMeta = {}) {
    const values = {},
      metadata = {};
    for (const key of new Set([
      ...Object.keys(remote || {}),
      ...Object.keys(local || {}),
      ...Object.keys(remoteMeta),
      ...Object.keys(localMeta),
    ])) {
      if (!safeKey(key)) continue;
      const hasLocal = own(local, key) || own(localMeta, key),
        useLocal = hasLocal && clock(localMeta[key]) >= clock(remoteMeta[key]);
      const value = useLocal ? local : remote,
        meta = (useLocal ? localMeta : remoteMeta)[key] || { updatedAt: EPOCH };
      if (clock(meta) > 0) metadata[key] = clone(meta);
      if (!meta.deletedAt && own(value, key)) values[key] = clone(value[key]);
    }
    return { values, metadata };
  }
  function merge(remoteInput, localInput, now = new Date().toISOString()) {
    const remote = normalize(remoteInput, now),
      local = normalize(localInput, now),
      data = { ...remote, ...local },
      markers = {};
    for (const type of collections) {
      markers[type] = {};
      for (const [id, timestamp] of [
        ...Object.entries(remote.deletionMarkers[type]),
        ...Object.entries(local.deletionMarkers[type]),
      ])
        if (!markers[type][id] || timestamp > markers[type][id]) markers[type][id] = timestamp;
      const rows = new Map(remote[type].map((record) => [record.id, record]));
      for (const record of local[type])
        if (!rows.has(record.id) || clock(record) >= clock(rows.get(record.id)))
          rows.set(record.id, record);
      data[type] = [...rows.values()];
    }
    data.hasScreenshotImport = remote.hasScreenshotImport || local.hasScreenshotImport;
    data.deletionMarkers = markers;
    for (const [field, meta] of [
      ["limits", "limitsMeta"],
      ["accountAliases", "accountAliasesMeta"],
    ]) {
      const merged = mergeMap(remote[field], local[field], remote[meta], local[meta]);
      data[field] = merged.values;
      data[meta] = merged.metadata;
    }
    const months = mergeMap(
      remote.budgetsByMonth,
      local.budgetsByMonth,
      remote.budgetsByMonthMeta,
      local.budgetsByMonthMeta,
    );
    data.budgetsByMonth = months.values;
    data.budgetsByMonthMeta = months.metadata;
    data.budgetLimitsMeta = {};
    for (const month of Object.keys(data.budgetsByMonth)) {
      if (
        clock(remote.budgetsByMonthMeta[month]) === 0 &&
        clock(local.budgetsByMonthMeta[month]) === 0
      ) {
        data.budgetLimitsMeta[month] = clone(
          own(local.budgetsByMonth, month)
            ? local.budgetLimitsMeta[month]
            : remote.budgetLimitsMeta[month],
        );
        continue;
      }
      const limits = mergeMap(
        remote.budgetsByMonth[month] || {},
        local.budgetsByMonth[month] || {},
        remote.budgetLimitsMeta[month],
        local.budgetLimitsMeta[month],
      );
      data.budgetsByMonth[month] = limits.values;
      data.budgetLimitsMeta[month] = limits.metadata;
    }
    data.categories = [...new Set([...remote.categories, ...local.categories])];
    data.removedScreenshotIds = { ...remote.removedScreenshotIds, ...local.removedScreenshotIds };
    return normalize(data, now);
  }
  function remove(input, type, id, now = new Date().toISOString()) {
    const data = normalize(input, now),
      record = data[type].find((record) => record.id === id);
    if (record) {
      const time = tick(record, now);
      record.deletedAt = time;
      record.updatedAt = time;
    }
    return normalize(data, now);
  }
  function replacement(input, current, now = new Date().toISOString()) {
    const data = normalize(input, now),
      previous = normalize(current, now);
    data.removedScreenshotIds = { ...previous.removedScreenshotIds, ...data.removedScreenshotIds };
    for (const type of collections) {
      const incoming = live(data[type]),
        ids = new Set(incoming.map((record) => record.id));
      data.deletionMarkers[type] = {
        ...previous.deletionMarkers[type],
        ...data.deletionMarkers[type],
      };
      for (const record of incoming) {
        record.updatedAt = tick(
          {
            updatedAt: new Date(
              Math.max(clock(record), Date.parse(data.deletionMarkers[type][record.id] || EPOCH)),
            ).toISOString(),
          },
          now,
        );
        delete record.deletedAt;
        delete data.deletionMarkers[type][record.id];
      }
      for (const record of previous[type])
        if (!ids.has(record.id)) {
          const time = tick(record, now);
          data.deletionMarkers[type][record.id] = time;
        }
      data[type] = incoming;
    }
    return stamp(data, previous, now);
  }
  function exportData(input) {
    const data = normalize(input);
    for (const type of collections) data[type] = live(data[type]);
    return data;
  }
  function validateMetadata(data) {
    const id = (key) => safeKey(key) && /^[a-zA-Z0-9_-]{1,160}$/.test(key);
    for (const type of collections) {
      const ids = new Set();
      for (const record of data[type] || []) {
        if (
          !id(record.id) ||
          ids.has(record.id) ||
          !validStamp(record.updatedAt) ||
          (record.deletedAt !== undefined && !validStamp(record.deletedAt))
        )
          throw Error("Некорректная метка записи");
        ids.add(record.id);
      }
      for (const [key, stamp] of Object.entries(data.deletionMarkers?.[type] || {}))
        if (!id(key) || !validStamp(stamp)) throw Error("Некорректная отметка удаления");
    }
    const maps = [
      data.limitsMeta,
      data.accountAliasesMeta,
      data.budgetsByMonthMeta,
      ...Object.values(data.budgetLimitsMeta || {}),
    ];
    for (const map of maps) {
      if (!map || typeof map !== "object" || Array.isArray(map))
        throw Error("Некорректные метки ключей");
      for (const [key, meta] of Object.entries(map))
        if (
          !safeKey(key) ||
          !meta ||
          !validStamp(meta.updatedAt) ||
          (meta.deletedAt !== undefined && !validStamp(meta.deletedAt))
        )
          throw Error("Некорректное время изменения");
    }
  }
  return {
    EPOCH,
    collections,
    live,
    clock,
    normalize,
    stamp,
    merge,
    remove,
    replacement,
    exportData,
    validateMetadata,
    stableId,
  };
})();
