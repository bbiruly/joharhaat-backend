/**
 * Seeds a testable catalog for the `arun_vendors_testing` vendor.
 *
 * Run with: npx tsx seed-test-catalog.ts
 *
 * Why this exists: the storefront filters by category **slug**, and the four
 * slugs its rails and filters use (`forest-foods`, `tribal-crafts`, `handloom`,
 * `natural-wellness`) did not exist in the database — only a single
 * `organic-produce` category did. So every category rail and every category
 * filter returned nothing, whatever was listed.
 *
 * Products are created in the state the real vendor → admin flow would leave
 * them in: APPROVED, published, reviewed, with variants. They carry **no
 * media**, deliberately — the storefront renders a missing photo as a labelled
 * placeholder, and inventing stock imagery is what this project has spent two
 * phases removing. Add real photos through the vendor panel.
 *
 * Idempotent: re-running updates rather than duplicating.
 */
import {
  JharkhandDistrict,
  ProductLifecycleStatus,
  WeeklyHaatDay,
} from './src/generated/prisma/client.js';
import { prisma } from './src/db/prisma.js';

const VENDOR_EMAIL = 'arunvendor@example.test';

const categories = [
  { slug: 'forest-foods', name: 'Forest Foods' },
  { slug: 'tribal-crafts', name: 'Tribal Crafts' },
  { slug: 'handloom', name: 'Handloom' },
  { slug: 'natural-wellness', name: 'Natural Wellness' },
];

interface Seed {
  slug: string;
  name: string;
  category: string;
  description: string;
  artisanStory: string;
  district: JharkhandDistrict;
  day: WeeklyHaatDay;
  materials?: string;
  dimensions?: string;
  care?: string;
  variants: { label: string; price: number; stock: number }[];
}

const products: Seed[] = [
  {
    slug: 'wild-forest-honey',
    name: 'Wild Forest Honey',
    category: 'forest-foods',
    description:
      'Raw, unheated honey gathered from wild colonies in the sal forests around Ranchi. Unfiltered, so it crystallises in winter — warm the jar gently and it returns to liquid.',
    artisanStory:
      'We climb for this honey the way our fathers did, taking only part of each comb so the colony survives the season.',
    district: JharkhandDistrict.RANCHI,
    day: WeeklyHaatDay.TUESDAY,
    materials: 'Raw wild honey',
    care: 'Store at room temperature. Do not refrigerate.',
    variants: [
      { label: '350 g', price: 449, stock: 24 },
      { label: '700 g', price: 799, stock: 12 },
    ],
  },
  {
    slug: 'mahua-ragi-laddu',
    name: 'Mahua & Ragi Laddu',
    category: 'forest-foods',
    description:
      'Hand-rolled laddus of mahua flower and finger millet, sweetened only with the mahua itself. A winter staple across Jharkhand.',
    artisanStory:
      'The mahua is collected before sunrise, when the flowers fall on their own and are still sweet.',
    district: JharkhandDistrict.RANCHI,
    day: WeeklyHaatDay.TUESDAY,
    materials: 'Mahua flower, ragi, ghee',
    care: 'Best within 3 weeks. Keep in an airtight jar.',
    variants: [
      { label: '250 g', price: 320, stock: 30 },
      { label: '500 g', price: 590, stock: 8 },
    ],
  },
  {
    slug: 'forest-millet-mix',
    name: 'Three-Millet Mix',
    category: 'forest-foods',
    description:
      'Ragi, kodo and sanwa in the proportion households here actually cook — for roti, porridge or khichdi.',
    artisanStory: 'Grown on rain-fed plots with no chemical input, the way this land allows.',
    district: JharkhandDistrict.RANCHI,
    day: WeeklyHaatDay.FRIDAY,
    materials: 'Ragi, kodo, sanwa',
    variants: [{ label: '1 kg', price: 260, stock: 40 }],
  },
  {
    slug: 'dokra-forest-deer',
    name: 'Dokra Forest Deer',
    category: 'tribal-crafts',
    description:
      'Cast in brass by the lost-wax method, one mould per piece. No two are identical — the surface keeps the marks of the wax thread it was wound from.',
    artisanStory:
      'Each figure takes nine days. The mould is broken to release it, so the piece can never be repeated.',
    district: JharkhandDistrict.RANCHI,
    day: WeeklyHaatDay.SATURDAY,
    materials: 'Brass, lost-wax cast',
    dimensions: '14 cm × 9 cm × 5 cm',
    care: 'Dust with a dry cloth. Do not polish with chemicals.',
    variants: [{ label: 'Single piece', price: 1290, stock: 6 }],
  },
  {
    slug: 'bamboo-storage-basket',
    name: 'Sirali Bamboo Basket',
    category: 'tribal-crafts',
    description:
      'Split-bamboo storage basket woven in a close spiral, strong enough for grain and light enough to carry full.',
    artisanStory: 'Cut at the right moon, soaked, split by hand. The weave is the same one we use at home.',
    district: JharkhandDistrict.RANCHI,
    day: WeeklyHaatDay.SATURDAY,
    materials: 'Sirali bamboo',
    dimensions: '30 cm diameter × 22 cm',
    care: 'Keep dry. Wipe with a damp cloth if needed.',
    variants: [
      { label: 'Medium', price: 899, stock: 10 },
      { label: 'Large', price: 1250, stock: 4 },
    ],
  },
  {
    slug: 'sohrai-painted-panel',
    name: 'Sohrai Painted Wall Panel',
    category: 'tribal-crafts',
    description:
      'Sohrai motifs painted in natural earth pigment on a seasoned wood panel — the same forms drawn on house walls at harvest.',
    artisanStory:
      'My mother painted these on our walls every Sohrai. I paint them on wood so they can travel.',
    district: JharkhandDistrict.RANCHI,
    day: WeeklyHaatDay.SATURDAY,
    materials: 'Wood, natural earth pigment',
    dimensions: '45 cm × 30 cm',
    variants: [{ label: 'One panel', price: 2100, stock: 3 }],
  },
  {
    slug: 'tussar-silk-stole',
    name: 'Tussar Silk Stole',
    category: 'handloom',
    description:
      'Handwoven tussar with its natural gold cast, finished with a plain selvedge. The slubs in the yarn are the fibre, not a flaw.',
    artisanStory: 'Four days at the loom for one stole. The colour is the cocoon’s own.',
    district: JharkhandDistrict.RANCHI,
    day: WeeklyHaatDay.THURSDAY,
    materials: '100% tussar silk',
    dimensions: '200 cm × 70 cm',
    care: 'Dry clean only.',
    variants: [{ label: 'One size', price: 2450, stock: 7 }],
  },
  {
    slug: 'handloom-cotton-gamcha',
    name: 'Handloom Cotton Gamcha',
    category: 'handloom',
    description:
      'The everyday checked cotton towel, woven on a pit loom. Softens with every wash.',
    artisanStory: 'We weave these between the silk orders. Every household here owns a stack.',
    district: JharkhandDistrict.RANCHI,
    day: WeeklyHaatDay.THURSDAY,
    materials: '100% cotton',
    dimensions: '180 cm × 90 cm',
    care: 'Machine wash cold.',
    variants: [
      { label: 'Single', price: 299, stock: 50 },
      { label: 'Pack of 3', price: 799, stock: 20 },
    ],
  },
  {
    slug: 'cold-pressed-mustard-oil',
    name: 'Kachi Ghani Mustard Oil',
    category: 'natural-wellness',
    description:
      'Cold-pressed in a wooden ghani at low speed, so the oil keeps its pungency. Filtered once, never refined.',
    artisanStory: 'The ghani turns slowly on purpose. Heat is what takes the strength out.',
    district: JharkhandDistrict.RANCHI,
    day: WeeklyHaatDay.FRIDAY,
    materials: 'Cold-pressed mustard seed',
    care: 'Keep the bottle closed and out of sunlight.',
    variants: [
      { label: '500 ml', price: 285, stock: 35 },
      { label: '1 L', price: 540, stock: 18 },
    ],
  },
  {
    slug: 'neem-tulsi-hair-oil',
    name: 'Neem & Tulsi Hair Oil',
    category: 'natural-wellness',
    description:
      'Coconut oil infused with neem, tulsi and bhringraj over a slow flame, then rested for a fortnight before bottling.',
    artisanStory: 'The recipe is my grandmother’s. The only change is that we bottle it now.',
    district: JharkhandDistrict.RANCHI,
    day: WeeklyHaatDay.FRIDAY,
    materials: 'Coconut oil, neem, tulsi, bhringraj',
    care: 'For external use only.',
    variants: [{ label: '200 ml', price: 349, stock: 22 }],
  },
];

async function main() {
  const owner = await prisma.user.findUnique({
    where: { email: VENDOR_EMAIL },
    select: { id: true, vendor: { select: { id: true, businessName: true } } },
  });
  if (!owner?.vendor) throw new Error(`No vendor found for ${VENDOR_EMAIL}`);
  const vendorId = owner.vendor.id;
  console.log(`Vendor: ${owner.vendor.businessName} (${vendorId})\n`);

  const categoryId = new Map<string, string>();
  for (const category of categories) {
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, isActive: true },
      create: { slug: category.slug, name: category.name, isActive: true },
      select: { id: true, slug: true },
    });
    categoryId.set(row.slug, row.id);
    console.log(`  category ${row.slug}`);
  }

  console.log('');
  const now = new Date();
  for (const seed of products) {
    const minPrice = Math.min(...seed.variants.map((variant) => variant.price));
    const data = {
      vendorId,
      categoryId: categoryId.get(seed.category)!,
      name: seed.name,
      description: seed.description,
      artisanStory: seed.artisanStory,
      district: seed.district,
      weeklyHaatDay: seed.day,
      minPrice,
      // The state the vendor → admin approval flow leaves a live product in.
      isPublished: true,
      lifecycleStatus: ProductLifecycleStatus.APPROVED,
      submittedAt: now,
      reviewedAt: now,
      materials: seed.materials ?? null,
      dimensions: seed.dimensions ?? null,
      careInstructions: seed.care ?? null,
      dispatchEstimate: '2–3 working days',
      returnPolicy: 'Return within 7 days if damaged or incorrect.',
    };

    const product = await prisma.product.upsert({
      where: { slug: seed.slug },
      update: data,
      create: { ...data, slug: seed.slug },
      select: { id: true },
    });

    // Replace variants so a re-run does not accumulate stale SKUs.
    await prisma.productVariant.deleteMany({ where: { productId: product.id } });
    await prisma.productVariant.createMany({
      data: seed.variants.map((variant, index) => ({
        productId: product.id,
        sku: `${seed.slug.toUpperCase().replaceAll('-', '')}-${index + 1}`,
        label: variant.label,
        price: variant.price,
        stock: variant.stock,
        lowStock: variant.stock < 5,
        isActive: true,
      })),
    });

    console.log(
      `  ${seed.name} — ${seed.category}, ${seed.variants.length} variant(s), from ₹${minPrice}`,
    );
  }

  const live = await prisma.product.count({
    where: { isPublished: true, vendor: { verificationStatus: 'VERIFIED' } },
  });
  console.log(`\nLive on the storefront: ${live} products`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
