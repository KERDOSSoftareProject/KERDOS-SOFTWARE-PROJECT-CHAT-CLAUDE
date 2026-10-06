// End-to-end test: import row → preparePriceImport → OrderGuide readiness
// Tests the complete path: invoice arithmetic resolves basis → fields populate
// → orderGuideAssessment clears all blockers → row is ready.
// Also tests that rows without sufficient evidence stay in Item Catalog.

import {preparePriceImport} from './price-import-review.js';
import {orderGuideAssessment} from './catalog-fields.js';
import {configureProcurement} from '../procurement.js';
import {configureCategoryProfile} from '../knowledge/category-profiles.js';
configureProcurement({industry:'restaurant'});
configureCategoryProfile('restaurant');

let passed=0, failed=0;
function t(label, got, want) {
  if (got === want) { passed++; }
  else { failed++; console.log('FAIL  ' + label + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
}
function ok(label, val, extra) {
  if (val) { passed++; }
  else { failed++; console.log('FAIL  ' + label + (extra ? ': ' + extra : '')); }
}

// Goods invoice entry that establishes LB basis for chicken breast
const chickenInvoice = {
  row: {
    code: '49200',
    description: 'CHIC BRST RAW BNLS RNDM CVP',
    packSize: '4/10 LB',
    sellingUnit: 'LB',
    priceBasis: 'measure',
    billingUnitEvidence:{kind:'goods-invoice-billed-unit',header:'UOM',unit:'LB'},
    qty: 40, price: 2.06, amount: 82.40,
    issues: [],
  },
  number: 'INV-2026-001',
  date: '2026-09-15',
};

// A category and catalog item that would receive the row
const meatCategory = {id: 'cat-meat', name: 'Meat & Poultry', is_holding_pen: false};
const chickenCatalogItem = {
  id: 'ci-chicken', name: 'Chicken Breast Boneless',
  category_id: 'cat-meat', category_reason: 'Meat product',
  category_review: false,
  brand_locked: false,
};

// ── TEST 1: Invoice arithmetic resolves basis ──────────────────────────────────
// Price sheet row with no explicit selling unit, but matching invoice with LB billing
{
  const sheetRow = {
    code: '49200',
    description: 'CHIC BRST RAW BNLS RNDM CVP',
    packSize: '4/10 LB',
    price: 2.06,
    sellingUnit: '',
    sellingUnitSource: '',
  };
  const prepared = preparePriceImport(sheetRow, null, null, [], [chickenInvoice]);
  t('invoice resolves: resolved is not null', prepared.resolved !== null, true);
  t('invoice resolves: sellingUnit is LB', prepared.resolved?.sellingUnit, 'LB');
  t('invoice resolves: basis is measure', prepared.resolved?.basis?.basis, 'measure');
  t('invoice resolves: source is invoice billing unit', prepared.resolved?.source, 'invoice billing unit');
  t('invoice resolves: requiresReview is false', !!prepared.requiresReview, false);
  ok('invoice resolves: no blocking reasons', prepared.reasons.length === 0, JSON.stringify(prepared.reasons));
}

// ── TEST 2: Inference without invoice — still suggested, requiresReview true ──
{
  const sheetRow = {
    code: '49200',
    description: 'CHIC BRST RAW BNLS RNDM CVP',
    packSize: '4/10 LB',
    price: 2.06,
    sellingUnit: '',
    sellingUnitSource: '',
  };
  const prepared = preparePriceImport(sheetRow, null, null, [], []);
  t('inference only: resolved is not null', prepared.resolved !== null, true);
  t('inference only: requiresReview is true', !!prepared.requiresReview, true);
  ok('inference only: reason mentions suggested', 
    prepared.reasons.some(r => /suggested|basis/i.test(r)));
}

// ── TEST 3: Explicit unit on sheet — resolves immediately, no review ───────────
{
  const sheetRow = {
    code: '49200',
    description: 'CHIC BRST RAW BNLS RNDM CVP',
    packSize: '4/10 LB',
    price: 2.06,
    sellingUnit: 'LB',
    sellingUnitSource: 'price header',
  };
  const prepared = preparePriceImport(sheetRow, null, null, [], []);
  t('explicit unit: resolved', prepared.resolved?.sellingUnit, 'LB');
  t('explicit unit: no review', !!prepared.requiresReview, false);
}

// ── TEST 4: Conflicting invoices — requiresReview true ────────────────────────
{
  const sheetRow = {
    code: '49200',
    description: 'CHIC BRST RAW BNLS RNDM CVP',
    packSize: '4/10 LB',
    price: 2.06,
    sellingUnit: '',
  };
  const conflictInvoice = {
    row: { ...chickenInvoice.row, sellingUnit: 'CS', priceBasis: 'selling-unit',
           qty: 1, price: 82.40, amount: 82.40 },
    number: 'INV-2026-002', date: '2026-09-16',
  };
  const prepared = preparePriceImport(sheetRow, null, null, [], [chickenInvoice, conflictInvoice]);
  t('conflict invoices: requiresReview', !!prepared.requiresReview, true);
  ok('conflict invoices: reason mentions conflict',
    prepared.reasons.some(r => /conflict|billing unit|disagree/i.test(r)));
}

// ── TEST 5: Order Guide assessment — invoice-resolved row clears all gates ────
// Simulate what orderGuideAssessment sees after applyQuote writes the resolved fields.
{
  // What applyQuote would write to the vendor_item record
  const vendorItem = {
    id: 'vi-1',
    vendor_id: 'v-1',
    description: 'CHIC BRST RAW BNLS RNDM CVP',
    pack_size: '4/10 LB',
    selling_unit: 'LB',
    price_basis: 'measure',
    price: 2.06,
    price_unavailable: false,
    price_source: 'pricelist',
    import_row: {
      reviewRequired: false,   // invoice arithmetic resolved — no review needed
    },
    field_resolutions: {},
    brand: null,
  };
  const mapping = {
    id: 'm-1',
    catalog_item_id: 'ci-chicken',
    vendor_item_id: 'vi-1',
    comparison_track: 'exact',
    confidence_score: 100,
    match_method: 'rule_based',
  };
  const assessment = orderGuideAssessment({
    item: chickenCatalogItem,
    vendorItem,
    mapping,
    vendor: {id:'v-1', name:'Test Vendor'},
    category: meatCategory,
    peers: [],
    categories: [meatCategory],
    settings: {},
    now: new Date('2026-10-06'),
  });
  ok('order guide: no blockers', assessment.blockers.length === 0,
    'blockers: ' + JSON.stringify(assessment.blockers));
  t('order guide: ready', assessment.ready, true);
}

// ── TEST 6: Inferred row stays in Item Catalog — source blocker present ────────
{
  const vendorItem = {
    id: 'vi-2',
    vendor_id: 'v-1',
    description: 'CHIC BRST RAW BNLS RNDM CVP',
    pack_size: '4/10 LB',
    selling_unit: 'LB',
    price_basis: 'measure',
    price: 2.06,
    price_unavailable: true,   // set because requiresReview (inference only)
    price_source: 'pricelist',
    import_row: {
      reviewRequired: true,    // inference only — client must confirm
    },
    field_resolutions: {},
    brand: null,
  };
  const mapping = {
    id: 'm-2',
    catalog_item_id: 'ci-chicken',
    vendor_item_id: 'vi-2',
    comparison_track: 'exact',
    confidence_score: 100,
    match_method: 'rule_based',
  };
  const assessment = orderGuideAssessment({
    item: chickenCatalogItem,
    vendorItem,
    mapping,
    vendor: {id:'v-1', name:'Test Vendor'},
    category: meatCategory,
    peers: [],
    categories: [meatCategory],
    settings: {},
    now: new Date('2026-10-06'),
  });
  ok('inferred row: has blockers', assessment.blockers.length > 0);
  ok('inferred row: source or quote blocker',
    assessment.blockers.includes('source') || assessment.blockers.includes('quote'),
    'blockers: ' + JSON.stringify(assessment.blockers));
  t('inferred row: not ready', assessment.ready, false);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
