import type { Service, ServicePricingOption } from "@/types/domain";

/**
 * Pricing calculation utilities for MedEx services.
 * 
 * Rules from requirements:
 * - Parse money fields carefully, preserve precision
 * - Never treat missing/null/malformed as zero unless domain justifies
 * - Round only for display to 2 decimal places, not in middle of calculations
 * - Handle amount and percent discount/charge types explicitly
 * - Wellness services: calculate each wellnessPricing option using same formula,
 *   display clearly labelled lowest option
 */

/** Parse a money string; returns null if invalid/missing */
export const parseMoney = (value: string | null | undefined): number | null => {
  if (value == null || value === '') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isNaN(parsed) || !Number.isFinite(parsed) ? null : parsed
}

/** Calculate discount amount based on discountType */
const calculateDiscountAmount = (
  price: number,
  discount: number,
  discountType: 'percent' | 'amount'
): number => {
  if (discountType === 'percent') {
    return price * discount / 100
  }
  return discount
}

/** Calculate charge amount based on serviceChargeType */
const calculateChargeAmount = (
  afterDiscount: number,
  serviceCharge: number,
  serviceChargeType: 'percent' | 'amount'
): number => {
  if (serviceChargeType === 'percent') {
    return afterDiscount * serviceCharge / 100
  }
  return serviceCharge
}

/**
 * Calculate final price for a standard service.
 * Formula from requirements:
 * discountAmount = discountType === "percent" ? price * discount / 100 : discount
 * afterDiscount = price - discountAmount
 * chargeAmount = serviceChargeType === "percent" ? afterDiscount * serviceCharge / 100 : serviceCharge
 * finalPrice = afterDiscount + chargeAmount
 */
export const calculateFinalPrice = (
  price: number,
  discount: number,
  discountType: 'percent' | 'amount',
  serviceCharge: number,
  serviceChargeType: 'percent' | 'amount'
): { afterDiscount: number; discountAmount: number; chargeAmount: number; finalPrice: number } => {
  const discountAmount = calculateDiscountAmount(price, discount, discountType)
  const afterDiscount = price - discountAmount
  const chargeAmount = calculateChargeAmount(afterDiscount, serviceCharge, serviceChargeType)
  const finalPrice = afterDiscount + chargeAmount

  return { afterDiscount, discountAmount, chargeAmount, finalPrice }
}

/** Calculate final price for wellness pricing option */
export const calculateWellnessFinalPrice = (
  price: number,
  discount: number,
  discountType: 'percent' | 'amount',
  serviceCharge: number,
  serviceChargeType: 'percent' | 'amount'
): { afterDiscount: number; discountAmount: number; chargeAmount: number; finalPrice: number } => {
  return calculateFinalPrice(price, discount, discountType, serviceCharge, serviceChargeType)
}

/** Get the lowest-priced wellness option, formatted for display */
export const getLowestWellnessOption = (
  options: ServicePricingOption[]
): { price: number; duration: number; formatted: string } | null => {
  if (options.length === 0) return null

  // Calculate final price for each option and find the lowest
  let lowest: { price: number; duration: number; finalPrice: number } | null = null

  for (const option of options) {
    const parsedPrice = parseMoney(option.price)
    const parsedDiscount = parseMoney(option.discount)
    const parsedServiceCharge = parseMoney(option.serviceCharge)

    if (parsedPrice == null) continue // skip options without valid price

    const { finalPrice } = calculateWellnessFinalPrice(
      parsedPrice,
      parsedDiscount ?? 0,
      option.discountType ?? 'percent',
      parsedServiceCharge ?? 0,
      option.serviceChargeType ?? 'amount'
    )

    if (lowest === null || finalPrice < lowest.finalPrice) {
      lowest = {
        price: parsedPrice,
        duration: option.durationInMinutes,
        finalPrice,
      }
    }
  }

  if (lowest === null) return null

  return {
    price: lowest.price,
    duration: lowest.duration,
    formatted: `From THB ${lowest.finalPrice.toFixed(2)} for ${lowest.duration} min`,
  }
}

/** Format a price for display - round to 2 decimal places */
export const formatPrice = (value: number | null | undefined): string => {
  if (value == null) return 'Price unavailable'
  const num = Number(value)
  if (Number.isNaN(num) || !Number.isFinite(num)) return 'Price unavailable'
  return `THB ${num.toFixed(2)}`
}

/** Format a discounted price display: original struck through, final price */
export const formatDiscountedPrice = (
  originalPrice: number | null,
  finalPrice: number | null
): string => {
  if (originalPrice == null || finalPrice == null) {
    return finalPrice != null ? formatPrice(finalPrice) : 'Price unavailable'
  }
  return `
    <span style="text-decoration: line-through; color: #6b7280;">
      THB ${originalPrice.toFixed(2)}
    </span>
    <span style="color: #059669; font-weight: 500;">
      THB ${finalPrice.toFixed(2)}
    </span>`
}

/** Check if a service has valid pricing data */
export const hasValidPrice = (service: Service): boolean => {
  if (service.type === 'wellness') {
    return service.wellnessPricing.length > 0 && service.wellnessPricing.some(o => parseMoney(o.price) != null)
  }
  const price = parseMoney(service.price)
  return price != null && price > 0
}