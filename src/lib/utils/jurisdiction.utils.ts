import { isCommune, isCommuneActuelle } from '@/lib/utils/cog.utils';

export function getValidationProfile(): string {
  return (process.env.API_DEPOT_VALIDATION_PROFILE || '').trim().toLowerCase();
}

export function isUsValidationProfile(): boolean {
  return getValidationProfile() === 'us';
}

export function isUsJurisdictionCode(code: string): boolean {
  return /^\d{5}(\d{2})?$/.test(code);
}

export function isJurisdictionCode(
  code: string,
  options: { actuelle?: boolean } = {},
): boolean {
  if (isUsValidationProfile()) {
    return isUsJurisdictionCode(code);
  }

  return options.actuelle ? isCommuneActuelle(code) : isCommune(code);
}
