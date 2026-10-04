import Decimal from 'decimal.js';
import React, { useEffect, useMemo, useState } from 'react';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import { Translate, ValidatedField, ValidatedForm, isNumber, translate } from 'react-jhipster';
import { Link, useNavigate, useParams } from 'app/shared/routing/navigation';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { hasAnyAuthority } from 'app/shared/auth/private-route';
import { Authority } from 'app/shared/jhipster/constants';
import { getAllUrunForStokGirisi } from 'app/entities/urun/urun.reducer';
import { getUsers } from 'app/modules/administration/user-management/user-management.reducer';
import { StokHareketiTipi } from 'app/shared/model/enumerations/stok-hareketi-tipi.model';
import { convertDateTimeFromServer, convertDateTimeToServer, displayDefaultDateTime } from 'app/shared/util/date-utils';

import { createEntity, getEntity, reset, updateEntity } from './stok-girisi.reducer';
import { isEntityFormReady } from 'app/shared/util/entity-form';

const NON_ADMIN_TIPIS = ['FIRE', 'STOK_DUZELTME'];

/** Stock delta a movement type applies to the product stock. */
const tipEffect = (stokHareketiTipi: string | undefined, miktar: number) =>
  stokHareketiTipi === 'STOK_GIRISI' || stokHareketiTipi === 'STOK_DUZELTME' || stokHareketiTipi === 'IADE' ? miktar : -miktar;

export const StokGirisiUpdate = () => {
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { id } = useParams<'id'>();
  const isNew = id === undefined;

  const users = useAppSelector(state => state.userManagement.users);
  const uruns = useAppSelector(state => state.urun.satisUrunleri);
  const stokGirisiEntity = useAppSelector(state => state.stokGirisi.entity);
  const formReady = isEntityFormReady(stokGirisiEntity, id, isNew);
  const updating = useAppSelector(state => state.stokGirisi.updating);
  const updateSuccess = useAppSelector(state => state.stokGirisi.updateSuccess);
  const isAdmin = useAppSelector(state => hasAnyAuthority(state.authentication.account.authorities, [Authority.ADMIN]));

  const [selectedUrunId, setSelectedUrunId] = useState<number | null>(null);
  const [miktar, setMiktar] = useState(0);
  const [stokHareketiTipi, setStokHareketiTipi] = useState<string>('STOK_GIRISI');
  const [urunFilter, setUrunFilter] = useState('');

  // Keep the edited product selectable even when it is absent from the
  // stok-girisi product list (e.g. a deactivated product).
  const urunOptions = useMemo(() => {
    const list = [...uruns];
    const entityUrun = stokGirisiEntity?.urun;
    if (entityUrun?.id && !list.some(urun => urun.id === entityUrun.id)) {
      list.unshift(entityUrun);
    }
    return list;
  }, [uruns, stokGirisiEntity]);

  const filteredUrunOptions = useMemo(() => {
    const normalized = urunFilter.trim().toLocaleLowerCase('tr');
    if (!normalized) {
      return urunOptions;
    }
    return urunOptions.filter(urun => (urun.urunAdi ?? '').toLocaleLowerCase('tr').includes(normalized));
  }, [urunOptions, urunFilter]);

  const stokHareketiTipiValues = useMemo(
    () =>
      Object.keys(StokHareketiTipi).filter(
        tipi => isAdmin || !NON_ADMIN_TIPIS.includes(tipi) || tipi === stokGirisiEntity?.stokHareketiTipi,
      ),
    [isAdmin, stokGirisiEntity],
  );

  const selectedUrun = urunOptions.find(urun => urun.id === selectedUrunId);
  // On edit the persisted effect is already part of the product stock, so it is
  // reverted before the new effect is applied to show the resulting stock.
  const yeniStok = selectedUrun
    ? new Decimal(selectedUrun.stok ?? 0)
        .minus(
          isNew || selectedUrun.id !== stokGirisiEntity.urun?.id
            ? 0
            : tipEffect(stokGirisiEntity.stokHareketiTipi, stokGirisiEntity.miktar ?? 0),
        )
        .plus(tipEffect(stokHareketiTipi, miktar))
        .toString()
    : null;

  // Memoized identity matters: ValidatedForm resets the form whenever the
  // defaultValues reference changes, so it must not be rebuilt on every render.
  const defaultValues = useMemo(
    () =>
      isNew
        ? {
            tarih: displayDefaultDateTime(),
            stokHareketiTipi: 'STOK_GIRISI',
            notlar: 'Stok girişi',
          }
        : {
            stokHareketiTipi: 'STOK_GIRISI',
            ...stokGirisiEntity,
            tarih: convertDateTimeFromServer(stokGirisiEntity.tarih),
            user: typeof stokGirisiEntity?.user === 'object' ? stokGirisiEntity.user?.id : undefined,
            urun: stokGirisiEntity?.urun?.id,
          },
    [isNew, stokGirisiEntity],
  );

  const handleClose = () => {
    navigate(`/stok-girisi${location.search}`);
  };

  useEffect(() => {
    if (isNew) {
      dispatch(reset());
    } else {
      dispatch(getEntity(id));
    }

    dispatch(getUsers({}));
    dispatch(getAllUrunForStokGirisi());
  }, []);

  useEffect(() => {
    if (!isNew && stokGirisiEntity.id) {
      setSelectedUrunId(stokGirisiEntity.urun?.id ?? null);
      setMiktar(stokGirisiEntity.miktar ?? 0);
      setStokHareketiTipi(stokGirisiEntity.stokHareketiTipi ?? 'STOK_GIRISI');
    }
  }, [stokGirisiEntity.id]);

  useEffect(() => {
    if (updateSuccess) {
      handleClose();
    }
  }, [updateSuccess]);

  const saveEntity = values => {
    if (values.id !== undefined && typeof values.id !== 'number') {
      values.id = Number(values.id);
    }
    if (values.miktar !== undefined && typeof values.miktar !== 'number') {
      values.miktar = Number(values.miktar);
    }
    if (values.agirlik !== undefined && typeof values.agirlik !== 'number') {
      values.agirlik = Number(values.agirlik);
    }
    values.tarih = convertDateTimeToServer(values.tarih);

    const entity = {
      ...stokGirisiEntity,
      ...values,
      user: users.find(it => it.id?.toString() === values.user?.toString()),
      urun: urunOptions.find(it => it.id?.toString() === values.urun?.toString()),
    };

    if (isNew) {
      dispatch(createEntity(entity));
    } else {
      dispatch(updateEntity(entity));
    }
  };

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="8">
          <h2 id="koopApp.stokGirisi.home.createOrEditLabel" data-cy="StokGirisiCreateUpdateHeading">
            <Translate contentKey="koopApp.stokGirisi.home.createOrEditLabel">Create or edit a StokGirisi</Translate>
          </h2>
        </Col>
      </Row>
      <Row className="justify-content-center">
        <Col md="8">
          {!formReady ? (
            <p>{translate('reports.common.loading')}</p>
          ) : (
            <ValidatedForm defaultValues={defaultValues} onSubmit={saveEntity}>
              {!isNew && (
                <ValidatedField
                  name="id"
                  required
                  readOnly
                  id="stok-girisi-id"
                  label={translate('global.field.id')}
                  validate={{ required: true }}
                />
              )}
              <Form.Group className="mb-3" controlId="stok-girisi-urun-filter">
                <Form.Label>Ürün ara</Form.Label>
                <Form.Control type="text" placeholder="Ürün ara" value={urunFilter} onChange={e => setUrunFilter(e.target.value)} />
              </Form.Group>
              <ValidatedField
                label={translate('koopApp.stokGirisi.urun')}
                id="stok-girisi-urun"
                name="urun"
                data-cy="urun"
                type="select"
                onChange={e => setSelectedUrunId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="" key="0" />
                {filteredUrunOptions.map(urun => (
                  <option value={urun.id} key={urun.id}>
                    {urun.urunAdi}
                  </option>
                ))}
              </ValidatedField>
              {selectedUrun && (
                <Form.Group as={Row} className="mb-3">
                  <Form.Label column md={6}>
                    Güncel Stok: {selectedUrun.stok} {selectedUrun.birim}
                  </Form.Label>
                  {yeniStok !== null && (
                    <Form.Label column md={6} data-cy="yeni-stok">
                      Kaydedilecek Yeni Stok: {yeniStok} {selectedUrun.birim}
                    </Form.Label>
                  )}
                </Form.Group>
              )}
              <ValidatedField
                label={translate('koopApp.stokGirisi.miktar')}
                id="stok-girisi-miktar"
                name="miktar"
                data-cy="miktar"
                type="text"
                onChange={e => setMiktar(e.target.value === '' ? 0 : Number(e.target.value))}
                validate={{
                  required: { value: true, message: translate('entity.validation.required') },
                  validate: v => isNumber(v) || translate('entity.validation.number'),
                }}
              />
              <ValidatedField
                label={translate('koopApp.stokGirisi.agirlik')}
                id="stok-girisi-agirlik"
                name="agirlik"
                data-cy="agirlik"
                type="text"
              />
              <ValidatedField
                label={translate('koopApp.stokGirisi.notlar')}
                id="stok-girisi-notlar"
                name="notlar"
                data-cy="notlar"
                type="text"
                validate={{
                  required: { value: true, message: translate('entity.validation.required') },
                }}
              />
              <ValidatedField
                label={translate('koopApp.stokGirisi.stokHareketiTipi')}
                id="stok-girisi-stokHareketiTipi"
                name="stokHareketiTipi"
                data-cy="stokHareketiTipi"
                type="select"
                onChange={e => setStokHareketiTipi(e.target.value)}
              >
                {stokHareketiTipiValues.map(tipi => (
                  <option value={tipi} key={tipi}>
                    {translate(`koopApp.StokHareketiTipi.${tipi}`)}
                  </option>
                ))}
              </ValidatedField>
              <ValidatedField
                label={translate('koopApp.stokGirisi.tarih')}
                id="stok-girisi-tarih"
                name="tarih"
                data-cy="tarih"
                type="datetime-local"
                placeholder="YYYY-MM-DD HH:mm"
              />
              <ValidatedField id="stok-girisi-user" name="user" data-cy="user" label={translate('koopApp.stokGirisi.user')} type="select">
                <option value="" key="0" />
                {users
                  ? users.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.login}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <Button as={Link as any} id="cancel-save" data-cy="entityCreateCancelButton" to="/stok-girisi" replace variant="info">
                <FontAwesomeIcon icon="arrow-left" />
                &nbsp;
                <span className="d-none d-md-inline">
                  <Translate contentKey="entity.action.back">Back</Translate>
                </span>
              </Button>
              &nbsp;
              <Button variant="primary" id="save-entity" data-cy="entityCreateSaveButton" type="submit" disabled={updating}>
                <FontAwesomeIcon icon="save" />
                &nbsp;
                <Translate contentKey="entity.action.save">Save</Translate>
              </Button>
            </ValidatedForm>
          )}
        </Col>
      </Row>
    </div>
  );
};

export default StokGirisiUpdate;
