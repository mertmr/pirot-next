import React, { useEffect, useMemo } from 'react';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import { Translate, ValidatedField, ValidatedForm, isNumber, translate } from 'react-jhipster';
import { Link, useNavigate, useParams } from 'app/shared/routing/navigation';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { getEntities as getSatises } from 'app/entities/satis/satis.reducer';
import { getEntities as getUruns } from 'app/entities/urun/urun.reducer';

import { createEntity, getEntity, reset, updateEntity } from './satis-stok-hareketleri.reducer';
import { isEntityFormReady } from 'app/shared/util/entity-form';

export const SatisStokHareketleriUpdate = () => {
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { id } = useParams<'id'>();
  const isNew = id === undefined;

  const uruns = useAppSelector(state => state.urun.entities);
  const satises = useAppSelector(state => state.satis.entities);
  const satisStokHareketleriEntity = useAppSelector(state => state.satisStokHareketleri.entity);
  const formReady = isEntityFormReady(satisStokHareketleriEntity, id, isNew);
  const updating = useAppSelector(state => state.satisStokHareketleri.updating);
  const updateSuccess = useAppSelector(state => state.satisStokHareketleri.updateSuccess);

  const handleClose = () => {
    navigate(`/satis-stok-hareketleri${location.search}`);
  };

  useEffect(() => {
    if (isNew) {
      dispatch(reset());
    } else {
      dispatch(getEntity(id));
    }

    dispatch(getUruns({}));
    dispatch(getSatises({}));
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
    if (values.miktar !== undefined && typeof values.miktar !== 'number') {
      values.miktar = Number(values.miktar);
    }

    const entity = {
      ...satisStokHareketleriEntity,
      ...values,
      urun: uruns.find(it => it.id?.toString() === values.urun?.toString()),
      satis: satises.find(it => it.id?.toString() === values.satis?.toString()),
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
            ...satisStokHareketleriEntity,
            urun: satisStokHareketleriEntity?.urun?.id,
            satis: satisStokHareketleriEntity?.satis?.id,
          },
    [isNew, satisStokHareketleriEntity],
  );

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="8">
          <h2 id="koopApp.satisStokHareketleri.home.createOrEditLabel" data-cy="SatisStokHareketleriCreateUpdateHeading">
            <Translate contentKey="koopApp.satisStokHareketleri.home.createOrEditLabel">Create or edit a SatisStokHareketleri</Translate>
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
                  id="satis-stok-hareketleri-id"
                  label={translate('global.field.id')}
                  validate={{ required: true }}
                />
              )}
              <ValidatedField
                label={translate('koopApp.satisStokHareketleri.miktar')}
                id="satis-stok-hareketleri-miktar"
                name="miktar"
                data-cy="miktar"
                type="text"
                validate={{
                  required: { value: true, message: translate('entity.validation.required') },
                  validate: v => isNumber(v) || translate('entity.validation.number'),
                }}
              />
              <ValidatedField
                label={translate('koopApp.satisStokHareketleri.tutar')}
                id="satis-stok-hareketleri-tutar"
                name="tutar"
                data-cy="tutar"
                type="text"
                validate={{
                  required: { value: true, message: translate('entity.validation.required') },
                  validate: v => isNumber(v) || translate('entity.validation.number'),
                }}
              />
              <ValidatedField
                id="satis-stok-hareketleri-urun"
                name="urun"
                data-cy="urun"
                label={translate('koopApp.satisStokHareketleri.urun')}
                type="select"
              >
                <option value="" key="0" />
                {uruns
                  ? uruns.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.id}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <ValidatedField
                id="satis-stok-hareketleri-satis"
                name="satis"
                data-cy="satis"
                label={translate('koopApp.satisStokHareketleri.satis')}
                type="select"
              >
                <option value="" key="0" />
                {satises
                  ? satises.map(otherEntity => (
                      <option value={otherEntity.id} key={otherEntity.id}>
                        {otherEntity.id}
                      </option>
                    ))
                  : null}
              </ValidatedField>
              <Button
                as={Link as any}
                id="cancel-save"
                data-cy="entityCreateCancelButton"
                to="/satis-stok-hareketleri"
                replace
                variant="info"
              >
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

export default SatisStokHareketleriUpdate;
