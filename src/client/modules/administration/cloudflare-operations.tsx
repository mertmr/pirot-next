import { useEffect, useState } from 'react';
import axios from 'axios';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Table from 'react-bootstrap/Table';
import { Translate, translate } from 'app/shared/jhipster/language';
interface Operations {
  tenantId: number;
  emailEnabled: boolean;
  schemaVersion: number;
  entityCounts: Record<string, number>;
  pendingJobs: number;
  historyRecords: number;
  databaseBytes: number | null;
}
interface Settings {
  stockReportEmail: string;
  stockReportEnabled: boolean;
  maxDiscountPercent: string;
}
export default function CloudflareOperations() {
  const [operations, setOperations] = useState<Operations | null>(null),
    [settings, setSettings] = useState<Settings>({ stockReportEmail: '', stockReportEnabled: false, maxDiscountPercent: '0' });
  const [tenants, setTenants] = useState<{ id: number; tenantName: string }[]>([]),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(false),
    [saving, setSaving] = useState(false);
  const load = async () => {
    try {
      const [op, config, directory] = await Promise.all([
        axios.get<Operations>('/api/cooperative-operations'),
        axios.get<Settings>('/api/cooperative-settings'),
        axios.get<{ id: number; tenantName: string }[]>('/api/tenants'),
      ]);
      setOperations(op.data);
      setSettings(config.data);
      setTenants(directory.data);
    } catch {
      setError(translate('cloudflare.loadError'));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess(false);
    setSaving(true);
    try {
      await axios.put('/api/cooperative-settings', settings);
      setSuccess(true);
    } catch {
      setError(translate('cloudflare.saveError'));
    } finally {
      setSaving(false);
    }
  };
  const createTenant = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await axios.post('/api/tenants', { tenantName: name });
      setName('');
      await load();
    } catch {
      setError(translate('cloudflare.saveError'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div>
      <h2>
        <Translate contentKey="cloudflare.operations" />
      </h2>
      {error && <Alert variant="danger">{error}</Alert>}
      {success && (
        <Alert variant="success">
          <Translate contentKey="cloudflare.saved" />
        </Alert>
      )}
      <p>
        <Translate contentKey="cloudflare.dashboardHelp" />{' '}
        <a href="https://dash.cloudflare.com" target="_blank" rel="noreferrer">
          Cloudflare Dashboard
        </a>
      </p>
      {operations && (
        <Table>
          <tbody>
            <tr>
              <th>
                <Translate contentKey="cloudflare.tenant" />
              </th>
              <td>{operations.tenantId}</td>
            </tr>
            <tr>
              <th>
                <Translate contentKey="cloudflare.schemaVersion" />
              </th>
              <td>{operations.schemaVersion}</td>
            </tr>
            <tr>
              <th>
                <Translate contentKey="cloudflare.databaseSize" />
              </th>
              <td>
                {operations.databaseBytes === null ? (
                  <Translate contentKey="cloudflare.databaseSizeDashboard" />
                ) : (
                  `${(operations.databaseBytes / 1048576).toFixed(2)} MB`
                )}
              </td>
            </tr>
            <tr>
              <th>
                <Translate contentKey="cloudflare.pendingJobs" />
              </th>
              <td>{operations.pendingJobs}</td>
            </tr>
            <tr>
              <th>
                <Translate contentKey="cloudflare.historyRecords" />
              </th>
              <td>{operations.historyRecords}</td>
            </tr>
          </tbody>
        </Table>
      )}
      {operations?.emailEnabled === false && (
        <Alert variant="info">
          <Translate contentKey="cloudflare.emailUnavailable" />
        </Alert>
      )}
      <h3>
        <Translate contentKey="cloudflare.stockReports" />
      </h3>
      <Form onSubmit={save}>
        <Form.Group className="mb-3">
          <Form.Label>
            <Translate contentKey="cloudflare.reportEmail" />
          </Form.Label>
          <Form.Control
            type="email"
            disabled={operations?.emailEnabled === false}
            value={settings.stockReportEmail}
            onChange={e => setSettings({ ...settings, stockReportEmail: e.target.value })}
          />
        </Form.Group>
        <Form.Check
          type="checkbox"
          label={translate('cloudflare.enableReports')}
          checked={settings.stockReportEnabled}
          onChange={e => setSettings({ ...settings, stockReportEnabled: e.target.checked })}
        />
        <Form.Group className="mt-3">
          <Form.Label>
            <Translate contentKey="cloudflare.maxDiscountPercent" />
          </Form.Label>
          <Form.Control
            type="number"
            min={0}
            max={100}
            step={1}
            value={settings.maxDiscountPercent}
            onChange={e => setSettings({ ...settings, maxDiscountPercent: e.target.value })}
          />
          <Form.Text>
            <Translate contentKey="cloudflare.maxDiscountPercentHelp" />
          </Form.Text>
        </Form.Group>
        <Button type="submit" disabled={saving}>
          <Translate contentKey="entity.action.save" />
        </Button>
      </Form>
      <h3 className="mt-4">
        <Translate contentKey="cloudflare.tenants" />
      </h3>
      <Table>
        <tbody>
          {tenants.map(t => (
            <tr key={t.id}>
              <td>{t.id}</td>
              <td>{t.tenantName}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Form onSubmit={createTenant}>
        <Form.Group className="mb-3">
          <Form.Label>
            <Translate contentKey="cloudflare.tenantName" />
          </Form.Label>
          <Form.Control value={name} maxLength={50} required onChange={e => setName(e.target.value)} />
        </Form.Group>
        <Button type="submit" disabled={saving}>
          <Translate contentKey="cloudflare.createTenant" />
        </Button>
      </Form>
    </div>
  );
}
