import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type DocumentRow } from '../lib/api'

/** An orphan invoice / misc email that has no shipment identity yet — surfaced in the
 *  "Unlinked Documents" review inbox so a coordinator can manually link it to a shipment.
 *  Shape is fixed by the backend contract for GET /api/documents. */
export type UnlinkedDocument = DocumentRow

export function useDocuments() {
  return useQuery<UnlinkedDocument[]>({
    queryKey: ['documents'],
    queryFn: () => api.getDocuments(),
  })
}

/** Badge count for the sidebar — reuses the same query so it stays in sync with the page. */
export function useDocumentCount() {
  const { data } = useDocuments()
  return data?.length ?? 0
}

export function useLinkDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ documentId, shipmentId }: { documentId: string; shipmentId: string }) =>
      api.linkDocument(documentId, shipmentId),
    onSuccess: () => {
      // Linked row disappears from the inbox; the shipment now owns the email.
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['shipment'] })
    },
  })
}
