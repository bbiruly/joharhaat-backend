import { PrismaPg } from '@prisma/adapter-pg';
import { JharkhandDistrict, PrismaClient, UserRole, VerificationStatus, WeeklyHaatDay } from '../src/generated/prisma/client.js';

const connectionString = process.env.DIRECT_URL;
if (!connectionString) throw new Error('DIRECT_URL is required to seed the database.');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  const customer = await prisma.user.upsert({ where: { mobile: '9876543210' }, update: {}, create: { name: 'Asha Munda', mobile: '9876543210', email: 'asha@example.test', role: UserRole.CUSTOMER } });
  await prisma.user.upsert({ where: { mobile: '9999999999' }, update: {}, create: { name: 'JoharHaat Admin', mobile: '9999999999', email: 'admin@example.test', role: UserRole.ADMIN } });
  const vendorOwner = await prisma.user.upsert({ where: { mobile: '9765432109' }, update: {}, create: { name: 'Sushila Devi', mobile: '9765432109', role: UserRole.VENDOR } });
  const vendor = await prisma.vendor.upsert({
    where: { msmeNumber: 'UDYAM-JH-20-0000001' },
    update: { verificationStatus: VerificationStatus.VERIFIED },
    create: { ownerId: vendorOwner.id, businessName: 'Khunti Van Dhan SHG', shgGroupName: 'Johar Sakhi Mandal', district: JharkhandDistrict.KHUNTI, region: 'South Chotanagpur', msmeNumber: 'UDYAM-JH-20-0000001', msmeCertificateUrl: 'https://example.test/mock-msme.pdf', verificationStatus: VerificationStatus.VERIFIED },
  });
  const category = await prisma.category.upsert({ where: { slug: 'organic-produce' }, update: {}, create: { slug: 'organic-produce', name: 'Organic Produce' } });
  const haat = await prisma.weeklyHaat.upsert({
    where: { district_day_name: { district: JharkhandDistrict.KHUNTI, day: WeeklyHaatDay.TUESDAY, name: 'Khunti Organic Haat' } },
    update: {},
    create: { name: 'Khunti Organic Haat', district: JharkhandDistrict.KHUNTI, day: WeeklyHaatDay.TUESDAY, opensAt: '08:00', closesAt: '17:00', isEnabled: true, isLive: true },
  });
  const product = await prisma.product.upsert({
    where: { slug: 'forest-mahua-flowers' },
    update: {},
    create: { vendorId: vendor.id, categoryId: category.id, weeklyHaatId: haat.id, name: 'Forest Mahua Flowers', slug: 'forest-mahua-flowers', description: 'Sun-dried mahua flowers collected by a women-led forest collective.', artisanStory: 'Collected sustainably in Khunti and prepared using traditional knowledge.', district: JharkhandDistrict.KHUNTI, weeklyHaatDay: WeeklyHaatDay.TUESDAY, minPrice: '240.00', isPublished: true },
  });
  const variant = await prisma.productVariant.upsert({ where: { sku: 'JH-MAHUA-1KG' }, update: {}, create: { productId: product.id, sku: 'JH-MAHUA-1KG', label: '1 kg', price: '240.00', stock: 25, lowStock: false } });
  const address = await prisma.address.findFirst({ where: { userId: customer.id, isDefault: true } }) ?? await prisma.address.create({ data: { userId: customer.id, label: 'Home', fullName: customer.name, mobile: customer.mobile, line1: 'Main Road, Torpa', district: JharkhandDistrict.KHUNTI, postalCode: '835227', isDefault: true } });
  const existingCart = await prisma.cart.findFirst({ where: { customerId: customer.id, order: null } });
  const cart = existingCart ?? await prisma.cart.create({ data: { customerId: customer.id } });
  await prisma.cartItem.upsert({ where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } }, update: { quantity: 2 }, create: { cartId: cart.id, variantId: variant.id, quantity: 2 } });
  console.info({ customerId: customer.id, addressId: address.id, cartId: cart.id, variantId: variant.id }, 'Seed complete');
}

main().finally(async () => prisma.$disconnect());
