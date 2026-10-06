export function collectPageErrors(page) {
  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []

  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('requestfailed', request => {
    failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || 'unknown'}`)
  })

  return { consoleErrors, pageErrors, failedRequests }
}
