import { Card } from '../ui/Card'
import { useVendors } from '../../hooks/use-vendors'
import { Factory } from 'lucide-react'

export function VendorsSettings() {
  const { data, isLoading } = useVendors()
  const vendors = data?.vendors ?? []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Vendors / Factories</h2>
        <p className="text-sm text-text-secondary">
          Vendor &amp; factory records are mirrored read-only from the Cobalt Mesh API. Maintain them in Cobalt Mesh;
          this app resolves them or flags unknowns for review.
        </p>
      </div>

      {/* Vendors list (read-only — vendors are maintained in Cobalt Mesh) */}
      {isLoading ? (
        <div className="text-sm text-text-muted">Loading vendors...</div>
      ) : vendors.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center rounded-xl border border-border bg-surface-800 text-text-muted">
          <Factory size={24} className="mb-2 opacity-50" />
          <p className="text-sm">No vendors configured</p>
        </div>
      ) : (
        <div className="space-y-2">
          {vendors.map((vendor) => (
            <Card key={vendor.id}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="truncate text-sm font-semibold text-text-primary">{vendor.name}</h4>
                    <span className="rounded bg-surface-600 px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
                      {vendor.type.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                    {vendor.location && <span>{vendor.location}</span>}
                    {vendor.contactEmail && <span className="break-all">{vendor.contactEmail}</span>}
                    {vendor.contactPhone && <span className="break-all">{vendor.contactPhone}</span>}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
