/**
 * Component-specific Error Boundaries with ARIA accessibility
 */

const React = require('react');

const styles = {
  primary: { background: '#1A1A18', color: '#fff', border: '1px solid #1A1A18' },
  button: { cursor: 'pointer', fontFamily: 'inherit' },
};

/**
 * Fallback UI for component errors - accessible version
 */
function createAccessibleErrorFallback(options = {}) {
  const { title = 'Etwas ist schiefgelaufen.', message = 'Bitte versuchen Sie es erneut.', retryLabel = 'Neu laden', icon = '⚠️' } = options;

  return function ErrorFallback({ error, retry }) {
    return React.createElement(
      'div',
      {
        style: { maxWidth: 480, margin: '30px auto', padding: 24, fontFamily: 'Georgia,serif', border: '1px solid #F7C1C1', borderRadius: 12, background: '#FFF8F8' },
        role: 'alert',
        'aria-live': 'polite',
        'aria-atomic': 'true',
      },
      React.createElement('div', { style: { fontSize: 20, marginBottom: 8, textAlign: 'center' } }, icon),
      React.createElement('div', { style: { fontSize: 16, fontWeight: 600, color: '#A32D2D', marginBottom: 8, textAlign: 'center' } }, title),
      error && React.createElement('div', { style: { fontSize: 12, color: '#8A8A8A', marginBottom: 12, fontStyle: 'italic', textAlign: 'center' } }, String(error?.message || error || 'Unbekannter Fehler')),
      React.createElement('div', { style: { fontSize: 13, color: '#666', marginBottom: 16, textAlign: 'center' } }, message),
      React.createElement('button', { onClick: retry, style: { ...styles.primary, padding: '10px 24px', borderRadius: 8, fontSize: 13 }, 'aria-label': retryLabel }, retryLabel),
    );
  };
}

/**
 * AppErrorBoundary - global boundary with ARIA attributes
 */
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '', error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, message: String(err?.message || err || 'Unbekannter Fehler'), error: err, retryCount: 0 };
  }

  componentDidCatch(err, info) {
    try { console.error('AppErrorBoundary', err, info); } catch (ignore) { }
  }

  retry = () => {
    this.setState({ hasError: false, message: '', error: null, retryCount: 0 });
    if (this.props.onRetry) this.props.onRetry();
  };

  render() {
    const Fallback = this.props.Fallback || createAccessibleErrorFallback({
      title: 'Etwas ist schiefgelaufen.',
      message: 'Bitte versuchen Sie es erneut.',
      retryLabel: 'App neu laden',
      onRetry: this.retry,
    });

    if (this.state.hasError) {
      return React.createElement(Fallback, { error: this.state.error, retry: this.retry, ...this.props });
    }
    return this.props.children;
  }
}

/**
 * TabErrorBoundary - catches errors only within individual tabs
 * Ensures navigation remains functional when a tab has an error
 */
class TabErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '', error: null };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, message: String(err?.message || err || 'Unbekannter Fehler'), error: err };
  }

  componentDidCatch(err, info) {
    console.error(`TabErrorBoundary (${this.props.tabName}):`, err, info);
  }

  retry = () => {
    this.setState({ hasError: false, message: '', error: null });
  };

  render() {
    const { children, tabName } = this.props;
    if (this.state.hasError) {
      return React.createElement(
        'div',
        {
          style: { width: '100%', padding: '20px', textAlign: 'center', border: '2px dashed #F5A623', borderRadius: 10, background: '#FFFBF0' },
          role: 'region',
          'aria-label': 'Fehler in Tab "' + tabName + '" - bitte neu laden',
          'aria-live': 'polite',
        },
        React.createElement('div', { style: { fontSize: 18, marginBottom: 12 } }, '⚠️'),
        React.createElement('div', { style: { fontSize: 16, fontWeight: 600, color: '#D35400', marginBottom: 8 } }, 'Tab "' + tabName + '" konnte nicht geladen werden'),
        React.createElement('div', { style: { fontSize: 13, color: '#666', marginBottom: 16 } }, this.state.message || 'Ein unerwarteter Fehler ist aufgetreten.'),
        React.createElement('button', { onClick: this.retry, style: { ...styles.primary, padding: '8px 16px', fontSize: 12 }, 'aria-label': 'Tab "' + tabName + '" erneut laden' }, 'Erneut versuchen'),
      );
    }
    return children;
  }
}

/**
 * DetailErrorBoundary - catches errors only in the detail overlay
 */
class DetailErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '', error: null };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, message: String(err?.message || err || 'Unbekannter Fehler'), error: err };
  }

  componentDidCatch(err, info) {
    console.error('DetailErrorBoundary:', err, info);
  }

  retry = () => {
    this.setState({ hasError: false, message: '', error: null });
  };

  render() {
    const { children, onClose } = this.props;
    if (this.state.hasError) {
      return React.createElement(
        'div',
        {
          style: { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': 'Detailansicht-Fehler - bitte schließen oder neu laden',
        },
        React.createElement(
          'div',
          {
            style: { background: '#fff', borderRadius: 12, padding: '32px', width: '90%', maxWidth: 400, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' },
          },
          React.createElement('button', { onClick: onClose, style: { position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#999' }, 'aria-label': 'Detailansicht schließen' }, '✕'),
          React.createElement('div', { style: { textAlign: 'center', marginBottom: 24 } },
            React.createElement('div', { style: { fontSize: 24, marginBottom: 12 } }, '⚠️'),
            React.createElement('div', { style: { fontSize: 18, fontWeight: 600, color: '#A32D2D', marginBottom: 12 } }, 'Details konnten nicht geladen werden'),
            React.createElement('div', { style: { fontSize: 14, color: '#666', marginBottom: 20 } }, this.state.message || 'Bitte versuchen Sie es erneut oder schließen Sie diese Ansicht.'),
            React.createElement('button', { onClick: this.retry, style: { ...styles.primary, padding: '10px 24px', borderRadius: 6, fontSize: 13, width: '100%', maxWidth: 200 }, 'aria-label': 'Detailansicht erneut laden' }, 'Erneut versuchen'),
          ),
        ),
      );
    }
    return children;
  }
}

/**
 * CollectionErrorBoundary - catches errors in the perfume collection list
 */
class CollectionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '', error: null };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, message: String(err?.message || err || 'Unbekannter Fehler'), error: err };
  }

  componentDidCatch(err, info) {
    console.error('CollectionErrorBoundary:', err, info);
  }

  render() {
    const { children } = this.props;
    if (this.state.hasError) {
      return React.createElement(
        'div',
        {
          style: { padding: '24px', textAlign: 'center', border: '1px dashed #e0e0e0', borderRadius: 8, background: '#fafafa' },
          role: 'region',
          'aria-label': 'Fehler beim Laden der Parfüm-Liste',
          'aria-live': 'polite',
        },
        React.createElement('div', { style: { fontSize: 18, marginBottom: 12 } }, '⚠️'),
        React.createElement('div', { style: { fontSize: 16, fontWeight: 600, color: '#666', marginBottom: 8 } }, 'Die Parfüm-Liste konnte nicht angezeigt werden'),
        React.createElement('div', { style: { fontSize: 13, color: '#888', marginBottom: 16 } }, this.state.message || 'Es scheint ein Problem beim Laden der Daten vorzuliegen.'),
        React.createElement('button', { onClick: () => this.setState({ hasError: false, message: '', error: null }), style: { ...styles.primary, padding: '8px 16px', fontSize: 12 }, 'aria-label': 'Parfüm-Liste erneut laden' }, 'Erneut versuchen'),
      );
    }
    return children;
  }
}

module.exports = {
  AppErrorBoundary,
  TabErrorBoundary,
  DetailErrorBoundary,
  CollectionErrorBoundary,
  createAccessibleErrorFallback,
};
