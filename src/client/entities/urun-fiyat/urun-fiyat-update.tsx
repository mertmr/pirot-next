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
import { convertDateTimeFromServer, convertDateTimeToServer, displayDefaultDateTime } from 'app/shared/util/date-utils';

import { createEntity, getEntity, reset, updateEntity } from './urun-fiyat.reducer';
import { isEntityFormReady } from 'app/shared/util/entity-form';

export const UrunFiyatUpdate = () => {
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { id } = useParams<'id'>();
  const isNew = id === undefined;

  const users = useAppSelector(state => state.userManagement.users);
  const uruns = useAppSelector(state => state.urun.entities);
  const urunFiyatEntity = useAppSelector(state => state.urunFiyat.entity);
  const formReady = isEntityFormReady(urunFiyatEntity, id, isNew);
  const updating = useAppSelector(state => state.urunFiyat.updating);
  const updateSuccess = useAppSelector(state => state.urunFiyat.updateSuccess);

  const handleClose = () => {
    navigate(`/urun-fiyat${location.search}`);
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
      ...urunFiyatEntity,
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
            ...urunFiyatEntity,
            tarih: convertDateTimeFromServer(urunFiyatEntity.tarih),
            user: urunFiyatEntity?.user?.id,
            urun: urunFiyatEntity?.urun?.id,
          },
    [isNew, urunFiyatEntity],
  );

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="8">
          <h2 id="koopApp.urunFiyat.home.createOrEditLabel" data-cy="UrunFiyatCreateUpdateHeading">
            <Translate contentKey="koopApp.urunFiyat.home.createOrEditLabel">Create or edit a UrunFiyat</Translate>
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
                  id="urun-fiyat-id"
                  label={translate('global.field.id')}
                  validate={{ required: true }}
                />
              )}
              <ValidatedField label={translate('koopApp.urunFiyat.fiyat')} id="urun-fiyat-fiyat" name="fiyat" data-cy="fiyat" type="text" />
              <ValidatedField
                label={translate('koopApp.urunFiyat.tarih')}
                id="urun-fiyat-tarih"
                name="tarih"
                data-cy="tarih"
                type="datetime-local"
                placeholder="YYYY-MM-DD HH:mm"
              />
              <ValidatedField id="urun-fiyat-user" name="user" data-cy="user" label={translate('koopApp.urunFiyat.user')} type="select">
                <option value="" key="0" />
                {users
                  ? users.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.login}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <ValidatedField id="urun-fiyat-urun" name="urun" data-cy="urun" label={translate('koopApp.urunFiyat.urun')} type="select">
                <option value="" key="0" />
                {uruns
                  ? uruns.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.id}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <Button as={Link as any} id="cancel-save" data-cy="entityCreateCancelButton" to="/urun-fiyat" replace variant="info">
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

export default UrunFiyatUpdate;
