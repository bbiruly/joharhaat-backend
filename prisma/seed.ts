import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'argon2';
import { AdminTeamRole, JharkhandDistrict, PrismaClient, ProductLifecycleStatus, UserRole, VerificationStatus, WeeklyHaatDay } from '../src/generated/prisma/client.js';
import { kolhanSoapCategories, kolhanSoapProducts } from './kolhan-soap-catalog.js';

const connectionString = process.env.DIRECT_URL;
if (!connectionString) throw new Error('DIRECT_URL is required to seed the database.');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  const demoPassword = await hash('JoharHaat123');
  const customer = await prisma.user.upsert({ where: { mobile: '9876543210' }, update: { passwordHash: demoPassword }, create: { name: 'Asha Munda', mobile: '9876543210', email: 'asha@example.test', passwordHash: demoPassword, role: UserRole.CUSTOMER } });
  const admin = await prisma.user.upsert({ where: { mobile: '9999999999' }, update: { name: 'JoharHaat Admin', email: 'admin@example.test', passwordHash: demoPassword, role: UserRole.ADMIN, isActive: true }, create: { name: 'JoharHaat Admin', mobile: '9999999999', email: 'admin@example.test', passwordHash: demoPassword, role: UserRole.ADMIN } });
  await prisma.adminMembership.upsert({ where: { userId: admin.id }, update: { role: AdminTeamRole.SUPER_ADMIN, isActive: true }, create: { userId: admin.id, role: AdminTeamRole.SUPER_ADMIN, isActive: true } });
  const vendorOwner = await prisma.user.upsert({ where: { mobile: '9765432109' }, update: { name: 'Sushila Devi', email: 'vendor@example.test', passwordHash: demoPassword, role: UserRole.VENDOR, isActive: true }, create: { name: 'Sushila Devi', mobile: '9765432109', email: 'vendor@example.test', passwordHash: demoPassword, role: UserRole.VENDOR } });
  const vendor = await prisma.vendor.upsert({
    where: { msmeNumber: 'UDYAM-JH-20-0000001' },
    update: { verificationStatus: VerificationStatus.VERIFIED },
    create: { ownerId: vendorOwner.id, businessName: 'Khunti Van Dhan SHG', shgGroupName: 'Johar Sakhi Mandal', district: JharkhandDistrict.KHUNTI, region: 'South Chotanagpur', msmeNumber: 'UDYAM-JH-20-0000001', msmeCertificateUrl: 'https://example.test/mock-msme.pdf', verificationStatus: VerificationStatus.VERIFIED },
  });
  const legacyCategories = [
    { slug: 'forest-foods', name: 'Forest Foods', nameHi: 'वन उपज', description: 'Honey, mahua, millets and forest produce', descriptionHi: 'शहद, महुआ, मोटा अनाज और वन उपज', displayOrder: 10 },
    { slug: 'tribal-crafts', name: 'Tribal Crafts', nameHi: 'आदिवासी शिल्प', description: 'Dokra metalwork, bamboo, wood and stone', descriptionHi: 'ढोकरा धातु, बाँस, लकड़ी और पत्थर', displayOrder: 20 },
    { slug: 'handloom', name: 'Handloom', nameHi: 'हथकरघा', description: 'Tussar silk, cotton weaves and tribal textiles', descriptionHi: 'तसर रेशम, सूती बुनाई और आदिवासी वस्त्र', displayOrder: 30 },
    { slug: 'natural-wellness', name: 'Natural Wellness', nameHi: 'प्राकृतिक सेहत', description: 'Cold-pressed oils, herbs and traditional remedies', descriptionHi: 'तेल, जड़ी-बूटियाँ और पारंपरिक नुस्ख़े', displayOrder: 40 },
  ];
  for (const item of [...legacyCategories, ...kolhanSoapCategories]) await prisma.category.upsert({ where: { slug: item.slug }, update: { ...item, isActive: true, isFeatured: true }, create: { ...item, isActive: true, isFeatured: true } });
  const category = await prisma.category.upsert({ where: { slug: 'organic-produce' }, update: { isActive: true }, create: { slug: 'organic-produce', name: 'Organic Produce' } });
  const haat = await prisma.weeklyHaat.upsert({
    where: { district_day_name: { district: JharkhandDistrict.KHUNTI, day: WeeklyHaatDay.TUESDAY, name: 'Khunti Organic Haat' } },
    update: {},
    create: { name: 'Khunti Organic Haat', district: JharkhandDistrict.KHUNTI, day: WeeklyHaatDay.TUESDAY, opensAt: '08:00', closesAt: '17:00', isEnabled: true, isLive: true },
  });
  const product = await prisma.product.upsert({
    where: { slug: 'forest-mahua-flowers' },
    update: { isPublished: false, lifecycleStatus: ProductLifecycleStatus.ARCHIVED },
    create: { vendorId: vendor.id, categoryId: category.id, weeklyHaatId: haat.id, name: 'Forest Mahua Flowers', slug: 'forest-mahua-flowers', description: 'Sun-dried mahua flowers collected by a women-led forest collective.', artisanStory: 'Collected sustainably in Khunti and prepared using traditional knowledge.', district: JharkhandDistrict.KHUNTI, weeklyHaatDay: WeeklyHaatDay.TUESDAY, minPrice: '240.00', isPublished: false, lifecycleStatus: ProductLifecycleStatus.ARCHIVED },
  });
  await prisma.productVariant.upsert({ where: { sku: 'JH-MAHUA-1KG' }, update: { stock: 0, lowStock: true, isActive: false }, create: { productId: product.id, sku: 'JH-MAHUA-1KG', label: '1 kg', price: '240.00', stock: 0, lowStock: true, isActive: false } });
  const kolhanVendor = await prisma.vendor.findFirst({ where: { businessName: { equals: 'Kolhan', mode: 'insensitive' }, verificationStatus: VerificationStatus.VERIFIED } });
  if (kolhanVendor) {
    for (const item of kolhanSoapProducts) {
      const itemCategory = await prisma.category.findUniqueOrThrow({ where: { slug: item.categorySlug } });
      const existingSoap = await prisma.product.findUnique({ where: { slug: item.slug } });
      if (existingSoap && existingSoap.vendorId !== kolhanVendor.id) throw new Error(`Kolhan product ${item.slug} is already assigned to a different vendor.`);
      const soap = await prisma.product.upsert({
        where: { slug: item.slug },
        update: { categoryId: itemCategory.id, name: item.name, description: item.description, minPrice: item.price },
        create: { vendorId: kolhanVendor.id, categoryId: itemCategory.id, name: item.name, slug: item.slug, description: item.description, minPrice: item.price, isPublished: item.initiallyPublished, lifecycleStatus: ProductLifecycleStatus.DRAFT },
      });
      const existingVariant = await prisma.productVariant.findUnique({ where: { sku: item.sku } });
      if (existingVariant && existingVariant.productId !== soap.id) throw new Error(`Kolhan SKU ${item.sku} is already assigned to a different product.`);
      await prisma.productVariant.upsert({
        where: { sku: item.sku },
        update: { label: item.label, price: item.price },
        create: { productId: soap.id, sku: item.sku, label: item.label, price: item.price, stock: item.initialStock, lowStock: item.initialStock === 0 },
      });
    }
  }
  const address = await prisma.address.findFirst({ where: { userId: customer.id, isDefault: true, isArchived: false } }) ?? await prisma.address.create({ data: { userId: customer.id, label: 'Home', fullName: customer.name, mobile: customer.mobile, line1: 'Main Road, Torpa', district: JharkhandDistrict.KHUNTI, state: 'Jharkhand', postalCode: '835227', isDefault: true } });
  const existingCart = await prisma.cart.findFirst({ where: { customerId: customer.id, order: null } });
  const cart = existingCart ?? await prisma.cart.create({ data: { customerId: customer.id } });
  await prisma.coupon.upsert({ where: { code: 'JOHAR10' }, update: {}, create: { code: 'JOHAR10', percent: '0.10', maxDiscount: '250.00', minOrderValue: '300.00', startsAt: new Date('2025-01-01T00:00:00Z'), expiresAt: new Date('2030-12-31T23:59:59Z'), perUserLimit: 1, isActive: true } });
  console.info({
    admin: { id: admin.id, email: admin.email, mobile: admin.mobile, password: 'JoharHaat123', role: 'SUPER_ADMIN' },
    vendor: { userId: vendorOwner.id, vendorId: vendor.id, email: vendorOwner.email, mobile: vendorOwner.mobile, password: 'JoharHaat123', businessName: vendor.businessName },
    customerId: customer.id,
    addressId: address.id,
    cartId: cart.id,
  }, 'Seed complete');
}

main().finally(async () => prisma.$disconnect());
