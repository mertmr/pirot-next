import React, { useEffect, useState, useMemo } from 'react';
import { CorrectionFields } from 'app/shared/financial/nobet-correction';
import { IDuzeltmeTalebi } from 'app/shared/model/nobet-duzeltme.model';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import { Translate, ValidatedField, ValidatedForm, isNumber, translate } from 'react-jhipster';
import { Link, useNavigate, useParams } from 'app/shared/routing/navigation';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { getUsers } from 'app/modules/administration/user-management/user-management.reducer';
import { GiderTipi } from 'app/shared/model/enumerations/gider-tipi.model';
import { OdemeAraci } from 'app/shared/model/enumerations/odeme-araci.model';
import { convertDateTimeFromServer, convertDateTimeToServer, displayDefaultDateTime } from 'app/shared/util/date-utils';

import { createEntity, getEntity, reset, updateEntity } from './gider.reducer';
import { isEntityFormReady } from 'app/shared/util/entity-form';

export const GiderUpdate = () => {
  const [closed, setClosed] = useState(false);
  const [duzeltme, setDuzeltme] = useState<IDuzeltmeTalebi>();
  const [correctionBlocked, setCorrectionBlocked] = useState(true);
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { id } = useParams<'id'>();
  const isNew = id === undefined;

  const users = useAppSelector(state => state.userManagement.users);
  const giderEntity = useAppSelector(state => state.gider.entity);
  const formReady = isEntityFormReady(giderEntity, id, isNew);
  const updating = useAppSelector(state => state.gider.updating);
  const updateSuccess = useAppSelector(state => state.gider.updateSuccess);
  const giderTipiValues = Object.keys(GiderTipi);
  const odemeAraciValues = Object.keys(OdemeAraci);

  const handleClose = () => {
    navigate(`/gider${location.search}`);
  };

  useEffect(() => {
    if (isNew) {
      dispatch(reset());
    } else {
      dispatch(getEntity(id));
    }

    dispatch(getUsers({}));
  }, []);

  useEffect(() => {
    if (updateSuccess) {
      handleClose();
    }
  }, [updateSuccess]);

  const saveEntity = values => {
    if (!isNew && correctionBlocked) return;
    if (values.id !== undefined && typeof values.id !== 'number') {
      values.id = Number(values.id);
    }
    values.tarih = convertDateTimeToServer(values.tarih);

    const entity = {
      ...giderEntity,
      ...values,
      duzeltme,
      user: users.find(it => it.id?.toString() === values.user?.toString()),
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
            giderTipi: 'KARGO',
            odemeAraci: 'NAKIT',
            ...giderEntity,
            tarih: convertDateTimeFromServer(giderEntity.tarih),
            user: giderEntity?.user?.id,
          },
    [isNew, giderEntity],
  );

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="8">
          <h2 id="koopApp.gider.home.createOrEditLabel" data-cy="GiderCreateUpdateHeading">
            <Translate contentKey="koopApp.gider.home.createOrEditLabel">Create or edit a Gider</Translate>
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
                <CorrectionFields type="gider" id={id} onChange={setDuzeltme} onBlocked={setCorrectionBlocked} onClosed={setClosed} />
              )}
              {!isNew && (
                <ValidatedField
                  name="id"
                  required
                  readOnly
                  id="gider-id"
                  label={translate('global.field.id')}
                  validate={{ required: true }}
                />
              )}
              <ValidatedField
                label={translate('koopApp.gider.tarih')}
                id="gider-tarih"
                name="tarih"
                data-cy="tarih"
                type="datetime-local"
                disabled={closed}
                placeholder="YYYY-MM-DD HH:mm"
              />
              <ValidatedField
                label={translate('koopApp.gider.tutar')}
                id="gider-tutar"
                name="tutar"
                data-cy="tutar"
                type="text"
                validate={{
                  required: { value: true, message: translate('entity.validation.required') },
                  validate: v => isNumber(v) || translate('entity.validation.number'),
                }}
              />
              <ValidatedField
                label={translate('koopApp.gider.notlar')}
                id="gider-notlar"
                name="notlar"
                data-cy="notlar"
                type="text"
                validate={{
                  required: { value: true, message: translate('entity.validation.required') },
                }}
              />
              <ValidatedField
                label={translate('koopApp.gider.giderTipi')}
                id="gider-giderTipi"
                name="giderTipi"
                data-cy="giderTipi"
                type="select"
              >
                {giderTipiValues.map(giderTipi => (
                  <option value={giderTipi} key={giderTipi}>
                    {translate(`koopApp.GiderTipi.${giderTipi}`)}
                  </option>
                ))}
              </ValidatedField>
              <ValidatedField
                label={translate('koopApp.gider.odemeAraci')}
                id="gider-odemeAraci"
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
              <ValidatedField id="gider-user" name="user" data-cy="user" label={translate('koopApp.gider.user')} type="select">
                <option value="" key="0" />
                {users
                  ? users.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.login}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <Button as={Link as any} id="cancel-save" data-cy="entityCreateCancelButton" to="/gider" replace variant="info">
                <FontAwesomeIcon icon="arrow-left" />
                &nbsp;
                <span className="d-none d-md-inline">
                  <Translate contentKey="entity.action.back">Back</Translate>
                </span>
              </Button>
              &nbsp;
              <Button
                variant="primary"
                id="save-entity"
                data-cy="entityCreateSaveButton"
                type="submit"
                disabled={updating || (!isNew && correctionBlocked)}
              >
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

export default GiderUpdate;
