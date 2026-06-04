/**
 * End-to-end test for the email processing pipeline.
 * Runs entirely in-process (no HTTP server needed) — imports the
 * pipeline directly and feeds it the sample emails.
 *
 * Usage: npx tsx src/test-pipeline.ts
 */

import { db } from './db/index.js'
import { shippingEmails, alerts, shipments, shipmentMilestones } from './db/schema.js'
import { processEmail } from './services/pipeline.js'
import { evaluateAlerts } from './services/alert-evaluator.js'
import { classifyEmail } from './services/classifier.js'
import { sampleEmails } from './db/sample-emails.js'
import { eq, sql } from 'drizzle-orm'

async function runTests() {
  console.log('='.repeat(60))
  console.log('ShipTrack Pipeline — End-to-End Test')
  console.log('='.repeat(60))
  console.log()

  // ── Test 1: Classifier ──────────────────────────────────────
  console.log('── Test 1: Email Classifier ──')
  let classifierPass = 0
  let classifierFail = 0

  for (const sample of sampleEmails) {
    const result = classifyEmail(sample.subject, sample.bodyText)
    const pass = result.emailType === sample.expectedType
    if (pass) {
      classifierPass++
    } else {
      classifierFail++
    }
    console.log(
      `  ${pass ? '✓' : '✗'} "${sample.description}"` +
      `  → ${result.emailType} (expected ${sample.expectedType})` +
      `  confidence=${result.confidence}` +
      `  keywords=[${result.matchedKeywords.slice(0, 3).join(', ')}]`
    )
  }
  console.log(`  Result: ${classifierPass}/${sampleEmails.length} passed\n`)

  // ── Test 2: Full Pipeline (regex fallback, no AI) ──────────
  console.log('── Test 2: Full Pipeline (regex fallback) ──')

  // Clear any previously inserted test emails
  const existingTestEmails = await db.select().from(shippingEmails)
  if (existingTestEmails.length > 0) {
    await db.delete(shippingEmails)
    console.log(`  Cleared ${existingTestEmails.length} existing emails`)
  }

  let pipelinePass = 0
  let pipelineFail = 0

  for (const sample of sampleEmails) {
    const result = await processEmail(
      db,
      {
        subject: sample.subject,
        sender: sample.sender,
        bodyText: sample.bodyText,
        receivedAt: new Date(),
      },
      { useAI: false } // Use regex fallback for deterministic testing
    )

    const typeMatch = result.emailType === sample.expectedType
    const shipmentMatch =
      sample.expectedShipmentId === ''
        ? !result.isMatched
        : result.shipmentId === sample.expectedShipmentId

    const pass = typeMatch && shipmentMatch
    if (pass) pipelinePass++
    else pipelineFail++

    console.log(
      `  ${pass ? '✓' : '✗'} "${sample.description}"` +
      `\n    type=${result.emailType} (${typeMatch ? 'ok' : 'MISMATCH: expected ' + sample.expectedType})` +
      `  matched=${result.isMatched} shipment=${result.shipmentId ?? 'none'}` +
      ` (${shipmentMatch ? 'ok' : 'MISMATCH: expected ' + (sample.expectedShipmentId || 'none')})` +
      `\n    milestone=${result.milestoneCreated}  shipmentUpdated=${result.shipmentUpdated}` +
      `  alerts +${result.alertsCreated}/-${result.alertsResolved}` +
      `  time=${result.processingTimeMs}ms` +
      (result.warnings.length > 0 ? `\n    warnings: ${result.warnings.join('; ')}` : '') +
      (result.errors.length > 0 ? `\n    ERRORS: ${result.errors.join('; ')}` : '')
    )
  }
  console.log(`  Result: ${pipelinePass}/${sampleEmails.length} passed\n`)

  // ── Test 3: Alert Evaluation ───────────────────────────────
  console.log('── Test 3: Alert Evaluation (all shipments) ──')
  const alertResult = await evaluateAlerts(db)
  console.log(`  Shipments evaluated: ${alertResult.shipmentsEvaluated}`)
  console.log(`  Alerts created: ${alertResult.alertsCreated}`)
  console.log(`  Alerts resolved: ${alertResult.alertsResolved}`)

  // List all active alerts after evaluation
  const activeAlerts = await db.select().from(alerts).where(eq(alerts.status, 'ACTIVE' as any))
  console.log(`  Total active alerts: ${activeAlerts.length}`)
  for (const alert of activeAlerts) {
    console.log(`    [${alert.severity}] ${alert.message} (shipment=${alert.shipmentId}, rule=${alert.ruleId})`)
  }
  console.log()

  // ── Test 4: Verify stored data ─────────────────────────────
  console.log('── Test 4: Stored Data Verification ──')
  const storedEmails = await db.select().from(shippingEmails)
  console.log(`  Emails stored: ${storedEmails.length}`)

  const completedEmails = storedEmails.filter((e: any) => e.processingStatus === 'COMPLETED')
  const failedEmails = storedEmails.filter((e: any) => e.processingStatus === 'FAILED')
  console.log(`  Completed: ${completedEmails.length}, Failed: ${failedEmails.length}`)

  const matchedEmails = storedEmails.filter((e: any) => e.isMatched)
  console.log(`  Matched to shipments: ${matchedEmails.length}`)

  // Check shipment statuses after pipeline
  const allShipments = await db.select().from(shipments)
  console.log(`  Shipment statuses:`)
  for (const s of allShipments) {
    console.log(`    ${s.id}: ${s.status} (risk=${s.riskLevel})`)
  }
  console.log()

  // ── Summary ────────────────────────────────────────────────
  console.log('='.repeat(60))
  const totalTests = classifierPass + classifierFail + pipelinePass + pipelineFail
  const totalPassed = classifierPass + pipelinePass
  console.log(
    `TOTAL: ${totalPassed}/${totalTests} tests passed` +
    (classifierFail + pipelineFail > 0 ? ' ⚠️ SOME FAILURES' : ' ✓ ALL PASSED')
  )
  console.log('='.repeat(60))
}

runTests().catch((err) => {
  console.error('Test failed with error:', err)
  process.exit(1)
})
