import { useGetSettings } from '@workspace/api-client-react';
import { composerDeliveryIssue } from '@/lib/composer-delivery';

export function useComposerDelivery() {
  const { data, isError, refetch } = useGetSettings();
  return {
    settings: data,
    deliveryIssue: composerDeliveryIssue(
      window.location.origin,
      isError ? undefined : data?.trackingBaseUrl,
    ),
    recheckSettings: refetch,
  };
}
