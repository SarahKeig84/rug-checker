/*
 * Rug Checker – recommendation engine
 *
 * Approach (summarised from BHS, Pony Club, vet & equine-science guidance –
 * see the "Guidance & sources" tab in the app):
 *   1. Start from the forecast temperature for the period (weighted toward the
 *      coldest hours, because horses should be rugged for the low, not the high).
 *   2. Turn that into a "felt" temperature for THIS horse by applying offsets
 *      for clip, breed type, age, body condition, wind, rain and shelter.
 *   3. A healthy adult horse with a full winter coat is comfortable down to
 *      roughly 5°C (bottom of the commonly cited 5–25°C thermoneutral zone)
 *      and often well below, so below a felt 5°C we add ~25g of fill per °C.
 *   4. Pick the rug (+ optional liner) combination from the owner's inventory
 *      that best matches that target, leaning lighter by default because
 *      over-rugging is the more common welfare problem.
 *
 * The numbers are a model, not a rule. Always check the horse by hand.
 */
(function (root) {
  'use strict';

  const CLIPS = {
    none:       { label: 'Unclipped',          offset: 0 },
    bib:        { label: 'Bib / neck clip',    offset: -1 },
    lowtrace:   { label: 'Low trace clip',     offset: -3 },
    hightrace:  { label: 'High trace / chaser clip', offset: -5 },
    blanket:    { label: 'Blanket clip',       offset: -6 },
    hunter:     { label: 'Hunter clip',        offset: -9 },
    full:       { label: 'Full clip',          offset: -10 },
  };

  const BREEDS = {
    native:     { label: 'Native pony / cob (hardy)',      offset: 3 },
    draught:    { label: 'Irish draught / heavy / draught cross', offset: 2 },
    warmblood:  { label: 'Warmblood / sports horse',       offset: 0 },
    other:      { label: 'Other / mixed',                  offset: 0 },
    tb:         { label: 'Thoroughbred / TB cross',        offset: -2 },
    arab:       { label: 'Arab / Arab cross',              offset: -2 },
    donkey:     { label: 'Donkey / mule',                  offset: -2, wetPenalty: 2 },
  };

  const CONDITION = {
    poor:       { label: 'Poor (ribs/hips prominent)',  offset: -3, vulnerable: true },
    lean:       { label: 'Lean',                        offset: -1 },
    ideal:      { label: 'Ideal',                       offset: 0 },
    overweight: { label: 'Overweight',                  offset: 2 },
    obese:      { label: 'Obese',                       offset: 4 },
  };

  const TEMPERAMENT = {
    cold:   { label: 'Feels the cold more than most', offset: -2 },
    normal: { label: 'Typical',                       offset: 0 },
    warm:   { label: 'Runs warm / sweats easily',     offset: 2 },
  };

  // Health conditions. offset = °C shift in felt temperature (negative = needs more warmth).
  // precise = keep the rug closely matched (avoid both too hot and too cold).
  // vulnerable = lean warmer when unsure. onlyIn = only applies while stabled.
  const HEALTH = {
    recovering: {
      label: 'Recovering from serious illness or surgery (e.g. peritonitis, colic surgery)',
      offset: -2, vulnerable: true, precise: true,
      note: 'Recovering horses have less in reserve to keep warm, but sweating under a rug also costs them fluid and energy. Check under the rug at least morning and evening, and follow any rugging advice from your vet.',
    },
    digestive: {
      label: 'Digestive condition (e.g. delayed gastric emptying, colic history, ulcers)',
      offset: -1, precise: true,
      note: 'Digesting forage is a major source of body heat, so a horse eating less hay than usual will feel the cold more. Keep an eye on appetite. Drinking less in cold weather is linked to colic risk, so make sure water isn’t icy (horses tend to drink more when it’s lukewarm).',
    },
    dental: {
      label: 'Dental problems / struggles to chew forage',
      offset: -1,
      note: 'Horses that can’t chew forage well get less warmth from digesting it. Watch their weight and appetite.',
    },
    arthritis: {
      label: 'Arthritis / stiffness',
      offset: -2, vulnerable: true,
      note: 'Cold, damp weather can make stiff joints worse, so keep arthritic horses comfortably warm, especially overnight.',
    },
    boxrest: {
      label: 'On box rest',
      offset: -2, onlyIn: true,
      note: 'On box rest a horse can’t move around to warm up, so it may need a little more rug than usual while stabled.',
    },
    ppid: {
      label: 'PPID (Cushing’s)',
      offset: 0, precise: true,
      note: 'Horses with PPID often have a thick coat that doesn’t shed properly and can overheat under a rug. Check for sweating, especially on milder days.',
    },
    ems: {
      label: 'EMS / laminitis-prone',
      offset: 1,
      note: 'For EMS or laminitis-prone horses, some natural winter weight loss helps, so avoid rugging more than needed.',
    },
    anhidrosis: {
      label: 'Anhidrosis (doesn’t sweat properly)',
      offset: 0, precise: true, overheat: true,
      note: 'With anhidrosis a horse can’t cool itself by sweating, so over-rugging is a real overheating risk. Lack of sweat is not a sign the rug is right.',
    },
    skin: {
      label: 'Rain scald / mud fever',
      offset: 0, precise: true,
      note: 'For rain scald or mud fever, keep the horse dry with a breathable waterproof rug, but avoid sweating underneath, because warm damp skin makes it worse.',
    },
    sweetitch: {
      label: 'Sweet itch',
      offset: 0, summer: true,
      note: 'Sweet itch: in midge season, a sweet itch rug or fly rug matters more than warmth.',
    },
  };

  // How much of the wind / rain the horse actually feels when turned out
  const SHELTER = {
    exposed:  { label: 'Exposed – little or no shelter', wind: 1.0, rain: 1.0 },
    natural:  { label: 'Natural shelter – hedges / trees', wind: 0.6, rain: 0.75 },
    shelter:  { label: 'Field shelter available',        wind: 0.35, rain: 0.4 },
  };

  const RUG_TYPES = {
    turnout: { label: 'Turnout rug (waterproof)', outer: true, waterproof: true },
    stable:  { label: 'Stable rug',               outer: true, waterproof: false },
    liner:   { label: 'Liner / under rug',        outer: false },
    fleece:  { label: 'Fleece / cooler',          outer: false, special: true },
    fly:     { label: 'Fly rug',                  outer: false, special: true },
  };

  const COMFORT_FLOOR = 5;      // °C – bottom of commonly cited thermoneutral zone
  const GRAMS_PER_DEGREE = 25;  // fill added per °C below the floor
  const MAX_GRAMS = 600;

  function ageOffset(age) {
    if (age == null || isNaN(age)) return { offset: 0, label: 'Age unknown' };
    if (age < 3) return { offset: -1, label: 'Youngster (under 3)' };
    if (age >= 25) return { offset: -3, label: 'Veteran (25+)', vulnerable: true };
    if (age >= 20) return { offset: -2, label: 'Older horse (20–24)', vulnerable: true };
    return { offset: 0, label: 'Adult' };
  }

  function gramsFor(feltTemp) {
    if (feltTemp >= COMFORT_FLOOR) return 0;
    const g = (COMFORT_FLOOR - feltTemp) * GRAMS_PER_DEGREE;
    return Math.min(MAX_GRAMS, Math.round(g / 25) * 25);
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  /** Summarise hourly forecast rows for a period. */
  function summariseWeather(hours) {
    const temps = hours.map(h => h.temp);
    const min = Math.min(...temps), max = Math.max(...temps);
    const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
    const wind = hours.reduce((a, h) => a + (h.wind || 0), 0) / hours.length;
    const gust = Math.max(...hours.map(h => h.gust || 0));
    const rainTotal = hours.reduce((a, h) => a + (h.precip || 0), 0);
    const rainProb = Math.max(...hours.map(h => h.precipProb || 0));
    const wet = rainTotal >= 1 || rainProb >= 60;
    return { min, max, mean, wind, gust, rainTotal, rainProb, wet, hours: hours.length };
  }

  /**
   * @param {object} p
   * @param {object} p.horse   {age, breed, clip, condition, temperament, shelter}
   * @param {'out'|'in'} p.type
   * @param {Array}  p.hours   [{temp, precip, precipProb, wind, gust}]
   * @param {Array}  p.inventory [{id, name, type, fill, neck}]
   * @param {number} [p.month] 1-12, for fly-rug suggestions
   */
  function recommend(p) {
    const { horse, type, inventory = [] } = p;
    const out = type === 'out';
    const w = summariseWeather(p.hours);
    const factors = [];
    const notes = [];

    // 1. Base temperature, weighted toward the coldest hours
    const base = 0.6 * w.min + 0.4 * w.mean;
    factors.push({ label: `Forecast (min ${round1(w.min)}°, avg ${round1(w.mean)}°) weighted to the low`, delta: null, value: round1(base) });

    let felt = base;
    const add = (label, delta) => {
      if (!delta) return;
      felt += delta;
      factors.push({ label, delta: round1(delta) });
    };

    const clip = CLIPS[horse.clip] || CLIPS.none;
    const breed = BREEDS[horse.breed] || BREEDS.other;
    const cond = CONDITION[horse.condition] || CONDITION.ideal;
    const temper = TEMPERAMENT[horse.temperament] || TEMPERAMENT.normal;
    const age = ageOffset(Number(horse.age));
    const shelter = SHELTER[horse.shelter] || SHELTER.exposed;

    add(clip.label, clip.offset);
    add(breed.label, breed.offset);
    add(age.label, age.offset);
    add(`Body condition: ${cond.label}`, cond.offset);
    add(temper.label, temper.offset);

    const health = (horse.health || []).map(k => HEALTH[k]).filter(Boolean);
    const month = p.month;
    const summer = month >= 4 && month <= 9;
    for (const h of health) {
      if (h.onlyIn && out) continue;
      add(h.label, h.offset);
    }

    if (out) {
      const windPenalty = -Math.min(w.wind / 5, 5) * shelter.wind;
      add(`Wind ${Math.round(w.wind)} mph (${shelter.label.split(' –')[0].toLowerCase()})`, windPenalty);
      if (w.wet) {
        const rainPenalty = -(2 + (breed.wetPenalty || 0)) * shelter.rain;
        add(`Rain expected (${round1(w.rainTotal)} mm, up to ${w.rainProb}% chance)`, rainPenalty);
      }
    } else {
      factors.push({ label: 'Stabled: out of wind & rain, but less able to move to keep warm', delta: 0 });
    }

    const target = gramsFor(felt);
    const vulnerable = !!(cond.vulnerable || age.vulnerable || health.some(h => h.vulnerable));
    const precise = !!(horse.precise || health.some(h => h.precise));
    const clipped = clip.offset <= -5;

    // Waterproofing need
    const needsWaterproof = out && (target > 0 || (w.wet && (clipped || breed.wetPenalty)));
    let effectiveTarget = target;
    if (out && target === 0 && w.wet && (clipped || breed.wetPenalty)) {
      notes.push(breed.wetPenalty
        ? 'Donkeys’ coats are not waterproof – a rain sheet or access to shelter is advised in wet weather.'
        : 'Clipped areas have lost their natural waterproofing – a 0g rain sheet keeps them dry without adding heat.');
    }
    if (out && target === 0 && w.wet && !clipped && !breed.wetPenalty) {
      notes.push('A full natural coat is water-resistant; most unclipped horses cope well with rain if they can get out of the wind.');
    }

    // Swing between coldest and warmest part of the period
    const feltAtMax = felt + (w.max - base);
    const targetAtMax = gramsFor(feltAtMax);
    if (target - targetAtMax >= (precise ? 100 : 150)) {
      notes.push(`Temperatures climb to ${round1(w.max)}°C during this period – a rug suited to the coldest hours (${target}g) could be too warm at the peak (~${targetAtMax}g). ${precise ? 'As this horse needs to be kept closely matched, plan to change to a lighter rug when it warms up.' : 'Consider changing rugs mid-period or going lighter.'}`);
    }

    // Neck cover
    let neckAdvised = false;
    if (out && (clip.offset <= -9 || horse.clip === 'hightrace') && (felt < -2 || (w.wet && w.wind > 15))) neckAdvised = true;
    if (felt < -8) neckAdvised = true;

    // Fly rug in warm months
    if (out && w.max >= 15 && summer) {
      const fly = inventory.find(r => r.type === 'fly');
      notes.push(fly ? `Warm enough for flies – consider the fly rug (${fly.name}).` : 'Warm enough for flies – a fly rug/mask may help in summer.');
    }

    if (horse.condition === 'overweight' || horse.condition === 'obese') {
      notes.push('Overweight horses benefit from losing some weight over winter – BHS and welfare charities advise against over-rugging so they burn some energy keeping warm.');
    }
    if (cond.vulnerable || age.vulnerable) {
      notes.push('Older horses or those in poor condition can struggle to stay warm – check them more often and err on the warmer side.');
    }

    // Health notes (shown on every result so they're not missed)
    const healthNotes = [];
    for (const h of health) {
      if (h.onlyIn && out) continue;
      if (h.summer && !summer) continue;
      if (h.overheat && w.max < 12 && target > 0) continue; // overheating note only matters on milder days
      healthNotes.push(h.note);
    }
    if (precise) {
      healthNotes.push('This horse is set to be kept closely matched, so the pick avoids both over- and under-rugging. Check under the rug behind the withers: sweating or damp means too warm, shivering or a cold body means too cool.');
    }

    const combos = buildCombos(inventory, { out, needsWaterproof });
    const scored = combos.map(c => {
      const diff = c.grams - effectiveTarget;
      // precise: symmetric; vulnerable: lean warmer; otherwise lean lighter (over-rugging is more common)
      const overW = precise ? 1.3 : vulnerable ? 1.0 : 1.4;
      const underW = precise ? 1.3 : vulnerable ? 1.4 : 1.0;
      let cost = diff > 0 ? diff * overW : -diff * underW;
      if (c.parts.length > 1) cost += 10; // slight preference for one rug
      if (!out && c.parts[0] && c.parts[0].type === 'turnout') cost += 45; // prefer stable rugs indoors
      if (neckAdvised && c.hasNeck) cost -= 15;
      return { ...c, diff, cost };
    }).sort((a, b) => a.cost - b.cost);

    let best = scored[0] || null;
    if (best && best.parts.length === 0 && needsWaterproof) best = scored.find(c => c.parts.length) || best;

    let status = 'ok';
    if (!best) {
      status = 'missing';
    } else if (Math.abs(best.diff) > (precise ? 50 : 100)) {
      status = 'approx';
      notes.unshift(`Nothing in your inventory is close to the ideal ~${effectiveTarget}g – the closest option is ${best.grams}g${best.diff > 0 ? ' (warmer)' : ' (cooler)'}.`);
    }

    return {
      type, weather: w,
      feltTemp: round1(felt),
      targetGrams: effectiveTarget,
      needsWaterproof, neckAdvised, vulnerable, precise,
      factors, notes, healthNotes, status,
      best,
      alternatives: scored.filter(c => c !== best).slice(0, 2),
      describeTarget: describeGrams(effectiveTarget, out, needsWaterproof),
    };
  }

  function buildCombos(inventory, { out, needsWaterproof }) {
    const outers = inventory.filter(r => {
      const t = RUG_TYPES[r.type];
      if (!t || !t.outer) return false;
      if (out) return t.waterproof;   // only waterproof rugs outside
      return true;                    // stable or turnout rug inside
    });
    const liners = inventory.filter(r => r.type === 'liner');
    const combos = [];
    if (!needsWaterproof) combos.push({ parts: [], grams: 0, hasNeck: false });
    for (const o of outers) {
      combos.push({ parts: [o], grams: +o.fill || 0, hasNeck: !!o.neck && o.neck !== 'none' });
      for (const l of liners) {
        combos.push({ parts: [o, l], grams: (+o.fill || 0) + (+l.fill || 0), hasNeck: !!o.neck && o.neck !== 'none' });
      }
    }
    return combos;
  }

  function describeGrams(g, out, waterproof) {
    const kind = out ? 'turnout' : 'stable';
    if (g === 0) return waterproof ? '0g rain sheet' : 'No rug needed';
    if (g <= 100) return `Lightweight ${kind} rug (~${g}g)`;
    if (g <= 225) return `Mediumweight ${kind} rug (~${g}g)`;
    if (g <= 350) return `Heavyweight ${kind} rug (~${g}g)`;
    return `Heavyweight ${kind} rug + liner (~${g}g)`;
  }

  const api = { recommend, summariseWeather, gramsFor, CLIPS, BREEDS, CONDITION, TEMPERAMENT, HEALTH, SHELTER, RUG_TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RugEngine = api;
})(this);
