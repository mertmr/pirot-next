import React, { useEffect, useMemo } from 'react';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import { Translate, ValidatedField, ValidatedForm, translate } from 'react-jhipster';
import { Link, useNavigate, useParams } from 'app/shared/routing/navigation';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { getEntities as getUruns } from 'app/entities/urun/urun.reducer';
import { getUsers } from 'app/modules/administration/user-management/user-management.reducer';
import { HareketTipi } from 'app/shared/model/enumerations/hareket-tipi.model';
import { OdemeAraci } from 'app/shared/model/enumerations/odeme-araci.model';
import { convertDateTimeFromServer, convertDateTimeToServer, displayDefaultDateTime } from 'app/shared/util/date-utils';

import { createEntity, getEntity, reset, updateEntity } from './borc-alacak.reducer';
import { isEntityFormReady } from 'app/shared/util/entity-form';

export const BorcAlacakUpdate = () => {
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { id } = useParams<'id'>();
  const isNew = id === undefined;

  const users = useAppSelector(state => state.userManagement.users);
  const uruns = useAppSelector(state => state.urun.entities);
  const borcAlacakEntity = useAppSelector(state => state.borcAlacak.entity);
  const formReady = isEntityFormReady(borcAlacakEntity, id, isNew);
  const updating = useAppSelector(state => state.borcAlacak.updating);
  const updateSuccess = useAppSelector(state => state.borcAlacak.updateSuccess);
  const odemeAraciValues = Object.keys(OdemeAraci);
  const hareketTipiValues = Object.keys(HareketTipi);

  const handleClose = () => {
    navigate(`/borc-alacak${location.search}`);
  };

  useEffect(() => {
    if (isNew) {
      dispatch(reset());
    } else {
      dispatch(getEntity(id));
    }

    dispatch(getUsers({}));
    dispatch(getUruns({}));
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
    values.tarih = convertDateTimeToServer(values.tarih);

    const entity = {
      ...borcAlacakEntity,
      ...values,
      user: users.find(it => it.id?.toString() === values.user?.toString()),
      urun: uruns.find(it => it.id?.toString() === values.urun?.toString()),
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
        ? {
            tarih: displayDefaultDateTime(),
          }
        : {
            odemeAraci: 'NAKIT',
            hareketTipi: 'URUN_GIRISI',
            ...borcAlacakEntity,
            tarih: convertDateTimeFromServer(borcAlacakEntity.tarih),
            user: borcAlacakEntity?.user?.id,
            urun: borcAlacakEntity?.urun?.id,
          },
    [isNew, borcAlacakEntity],
  );

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="8">
          <h2 id="koopApp.borcAlacak.home.createOrEditLabel" data-cy="BorcAlacakCreateUpdateHeading">
            <Translate contentKey="koopApp.borcAlacak.home.createOrEditLabel">Create or edit a BorcAlacak</Translate>
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
                  id="borc-alacak-id"
                  label={translate('global.field.id')}
                  validate={{ required: true }}
                />
              )}
              <ValidatedField
                label={translate('koopApp.borcAlacak.tutar')}
                id="borc-alacak-tutar"
                name="tutar"
                data-cy="tutar"
                type="text"
              />
              <ValidatedField
                label={translate('koopApp.borcAlacak.notlar')}
                id="borc-alacak-notlar"
                name="notlar"
                data-cy="notlar"
                type="text"
              />
              <ValidatedField
                label={translate('koopApp.borcAlacak.odemeAraci')}
                id="borc-alacak-odemeAraci"
                name="odemeAraci"
                data-cy="odemeAraci"
                type="select"
              >
                {odemeAraciValues.map(odemeAraci => (
                  <option value={odemeAraci} key={odemeAraci}>
                    {translate(`koopApp.OdemeAraci.${odemeAraci}`)}
                  </option>
                ))}
              </ValidatedField>
              <ValidatedField
                label={translate('koopApp.borcAlacak.hareketTipi')}
                id="borc-alacak-hareketTipi"
                name="hareketTipi"
                data-cy="hareketTipi"
                type="select"
              >
                {hareketTipiValues.map(hareketTipi => (
                  <option value={hareketTipi} key={hareketTipi}>
                    {translate(`koopApp.HareketTipi.${hareketTipi}`)}
                  </option>
                ))}
              </ValidatedField>
              <ValidatedField
                label={translate('koopApp.borcAlacak.tarih')}
                id="borc-alacak-tarih"
                name="tarih"
                data-cy="tarih"
                type="datetime-local"
                placeholder="YYYY-MM-DD HH:mm"
              />
              <ValidatedField id="borc-alacak-user" name="user" data-cy="user" label={translate('koopApp.borcAlacak.user')} type="select">
                <option value="" key="0" />
                {users
                  ? users.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.login}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <ValidatedField id="borc-alacak-urun" name="urun" data-cy="urun" label={translate('koopApp.borcAlacak.urun')} type="select">
                <option value="" key="0" />
                {uruns
                  ? uruns.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.urunAdi}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <Button as={Link as any} id="cancel-save" data-cy="entityCreateCancelButton" to="/borc-alacak" replace variant="info">
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

export default BorcAlacakUpdate;
