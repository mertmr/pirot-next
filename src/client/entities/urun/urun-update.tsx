import React, { useEffect, useMemo } from 'react';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import { Translate, ValidatedField, ValidatedForm, translate } from 'react-jhipster';
import { Link, useNavigate, useParams } from 'app/shared/routing/navigation';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { getEntities as getKdvKategorisis } from 'app/entities/kdv-kategorisi/kdv-kategorisi.reducer';
import { getUsers } from 'app/modules/administration/user-management/user-management.reducer';
import { Birim } from 'app/shared/model/enumerations/birim.model';
import { UrunKategorisi } from 'app/shared/model/enumerations/urun-kategorisi.model';

import { createEntity, getEntity, reset, updateEntity } from './urun.reducer';
import { isEntityFormReady } from 'app/shared/util/entity-form';

export const UrunUpdate = () => {
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { id } = useParams<'id'>();
  const isNew = id === undefined;

  const users = useAppSelector(state => state.userManagement.users);
  const kdvKategorisis = useAppSelector(state => state.kdvKategorisi.entities);
  const urunEntity = useAppSelector(state => state.urun.entity);
  const formReady = isEntityFormReady(urunEntity, id, isNew);
  const updating = useAppSelector(state => state.urun.updating);
  const updateSuccess = useAppSelector(state => state.urun.updateSuccess);
  const birimValues = Object.keys(Birim);
  const urunKategorisiValues = Object.keys(UrunKategorisi);
  const owner = urunEntity.urunSorumlusu;
  const selectableUsers = owner?.id && !users.some(user => String(user.id) === String(owner.id)) ? [...users, owner] : users;

  const handleClose = () => {
    navigate(`/urun${location.search}`);
  };

  useEffect(() => {
    if (isNew) {
      dispatch(reset());
    } else {
      dispatch(getEntity(id));
    }

    dispatch(getUsers({}));
    dispatch(getKdvKategorisis({}));
  }, []);

  useEffect(() => {
    if (updateSuccess) {
      handleClose();
    }
  }, [updateSuccess]);

  const saveEntity = values => {
    if (values.id !== undefined && typeof values.id !== 'number') {
      values.id = Number(values.id);
    }

    const entity = {
      ...urunEntity,
      ...values,
      urunSorumlusu: selectableUsers.find(it => it.id?.toString() === values.urunSorumlusu?.toString()),
      kdvKategorisi: kdvKategorisis.find(it => it.id?.toString() === values.kdvKategorisi?.toString()),
    };

    if (isNew) {
      dispatch(createEntity(entity));
    } else {
      dispatch(updateEntity(entity));
    }
  };

  // Memoized identity matters: ValidatedForm resets the form whenever the
  // defaultValues reference changes, so it must not be rebuilt on every render.
  const defaultValues = useMemo(
    () =>
      isNew
        ? {}
        : {
            birim: 'ADET',
            urunKategorisi: 'GIDA',
            ...urunEntity,
            urunSorumlusu: urunEntity?.urunSorumlusu?.id?.toString(),
            kdvKategorisi: urunEntity?.kdvKategorisi?.id?.toString(),
          },
    [isNew, urunEntity],
  );

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="8">
          <h2 id="koopApp.urun.home.createOrEditLabel" data-cy="UrunCreateUpdateHeading">
            <Translate contentKey="koopApp.urun.home.createOrEditLabel">Create or edit a Urun</Translate>
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
                  id="urun-id"
                  label={translate('global.field.id')}
                  validate={{ required: true }}
                />
              )}
              <ValidatedField
                label={translate('koopApp.urun.urunAdi')}
                id="urun-urunAdi"
                name="urunAdi"
                data-cy="urunAdi"
                type="text"
                validate={{
                  required: { value: true, message: translate('entity.validation.required') },
                }}
              />
              <ValidatedField label={translate('koopApp.urun.stok')} id="urun-stok" name="stok" data-cy="stok" type="text" />
              <ValidatedField
                label={translate('koopApp.urun.stokSiniri')}
                id="urun-stokSiniri"
                name="stokSiniri"
                data-cy="stokSiniri"
                type="text"
              />
              <ValidatedField
                label={translate('koopApp.urun.musteriFiyati')}
                id="urun-musteriFiyati"
                name="musteriFiyati"
                data-cy="musteriFiyati"
                type="text"
              />
              <ValidatedField label={translate('koopApp.urun.birim')} id="urun-birim" name="birim" data-cy="birim" type="select">
                {birimValues.map(birim => (
                  <option value={birim} key={birim}>
                    {translate(`koopApp.Birim.${birim}`)}
                  </option>
                ))}
              </ValidatedField>
              <ValidatedField
                label={translate('koopApp.urun.dayanismaUrunu')}
                id="urun-dayanismaUrunu"
                name="dayanismaUrunu"
                data-cy="dayanismaUrunu"
                check
                type="checkbox"
              />
              <ValidatedField
                label={translate('koopApp.urun.satista')}
                id="urun-satista"
                name="satista"
                data-cy="satista"
                check
                type="checkbox"
              />
              <ValidatedField
                label={translate('koopApp.urun.urunKategorisi')}
                id="urun-urunKategorisi"
                name="urunKategorisi"
                data-cy="urunKategorisi"
                type="select"
              >
                {urunKategorisiValues.map(urunKategorisi => (
                  <option value={urunKategorisi} key={urunKategorisi}>
                    {translate(`koopApp.UrunKategorisi.${urunKategorisi}`)}
                  </option>
                ))}
              </ValidatedField>
              <ValidatedField
                label={translate('koopApp.urun.active')}
                id="urun-active"
                name="active"
                data-cy="active"
                check
                type="checkbox"
              />
              <ValidatedField
                id="urun-urunSorumlusu"
                name="urunSorumlusu"
                data-cy="urunSorumlusu"
                label={translate('koopApp.urun.urunSorumlusu')}
                type="select"
              >
                <option value="" key="0" />
                {selectableUsers
                  ? selectableUsers.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.login}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <ValidatedField
                id="urun-kdvKategorisi"
                name="kdvKategorisi"
                data-cy="kdvKategorisi"
                label={translate('koopApp.urun.kdvKategorisi')}
                type="select"
              >
                <option value="" key="0" />
                {kdvKategorisis
                  ? kdvKategorisis.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.id}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <Button as={Link as any} id="cancel-save" data-cy="entityCreateCancelButton" to="/urun" replace variant="info">
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

export default UrunUpdate;
