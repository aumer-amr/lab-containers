package cloudflare

import (
	"context"

	cloudflareoauth "github.com/aumer-amr/lab-containers/cloudflare-oauth/type"
	cloudflare "github.com/cloudflare/cloudflare-go"
	log "github.com/sirupsen/logrus"
	v1 "k8s.io/api/networking/v1"
)

type CloudFlareWrapper struct {
	API    *cloudflare.API
	Config cloudflareoauth.Config
}

func Init(cfg cloudflareoauth.Config) (*CloudFlareWrapper, error) {
	var (
		cl_config *cloudflare.API
		err       error
	)

	cl_config, err = cloudflare.New(cfg.CL_Key, cfg.CL_Email)
	if err != nil {
		log.Fatal(err)
		return nil, err
	}

	ctx := context.Background()
	u, err := cl_config.UserDetails(ctx)
	if err != nil {
		log.Fatal(err)
	}

	log.Debugf("Cloudflare details: %v", u)

	wrapper := &CloudFlareWrapper{
		API:    cl_config,
		Config: cfg,
	}

	return wrapper, nil
}

func (wrapper *CloudFlareWrapper) CreateApplication(ingress v1.Ingress) (cloudflare.AccessApplication, bool) {
	log.Debugf("Creating application %s", ingress.Name)

	accessApplication, err := wrapper.API.CreateAccessApplication(context.Background(), wrapper.Config.CL_AccountID, cloudflare.AccessApplication{
		Name:            ingress.Name,
		Domain:          ingress.Spec.Rules[0].Host,
		Type:            "self_hosted",
		SessionDuration: "24h",
	})

	if err != nil {
		log.Error(err)
		return cloudflare.AccessApplication{}, false
	}

	log.Debugf("%v", accessApplication)
	return accessApplication, true
}

func (wrapper *CloudFlareWrapper) DeleteApplication(ingress v1.Ingress) bool {
	log.Debugf("Deleting application %s", ingress.Name)

	originalAccessApplication, err := wrapper.GetApplicationByName(ingress)

	if err != nil {
		log.Error(err)
		return false
	}

	err = wrapper.API.DeleteAccessApplication(context.Background(), wrapper.Config.CL_AccountID, originalAccessApplication.ID)

	if err != nil {
		log.Error(err)
		return false
	}

	return true
}

func (wrapper *CloudFlareWrapper) UpdateApplication(ingress v1.Ingress) (cloudflare.AccessApplication, bool) {
	log.Debugf("Updating application %s", ingress.Name)

	originalAccessApplication, err := wrapper.GetApplicationByName(ingress)

	if err != nil {
		log.Error(err)
		return cloudflare.AccessApplication{}, false
	}

	originalAccessApplication.Name = ingress.Name
	originalAccessApplication.Domain = ingress.Spec.Rules[0].Host
	originalAccessApplication.Type = "self_hosted"
	originalAccessApplication.SessionDuration = "24h"

	accessApplication, err := wrapper.API.UpdateAccessApplication(context.Background(), wrapper.Config.CL_AccountID, *originalAccessApplication)

	if err != nil {
		log.Error(err)
		return cloudflare.AccessApplication{}, false
	}

	log.Debugf("%v", accessApplication)
	return accessApplication, true
}

func (wrapper *CloudFlareWrapper) ApplicationExists(ingress v1.Ingress) bool {
	log.Debugf("Checking if application exists %s", ingress.Name)

	applications, _, err := wrapper.API.AccessApplications(context.Background(), wrapper.Config.CL_AccountID, cloudflare.PaginationOptions{
		PerPage: 100,
	})

	if err != nil {
		log.Error(err)
		return false
	}

	for _, application := range applications {
		if application.Name == ingress.Name {
			return true
		}
	}

	return false
}

func (wrapper *CloudFlareWrapper) GetApplicationByName(ingress v1.Ingress) (*cloudflare.AccessApplication, error) {
	log.Debugf("Getting application by name %s", ingress.Name)

	applications, _, err := wrapper.API.AccessApplications(context.Background(), wrapper.Config.CL_AccountID, cloudflare.PaginationOptions{
		PerPage: 100,
	})

	if err != nil {
		log.Error(err)
		return nil, err
	}

	for _, application := range applications {
		if application.Name == ingress.Name {
			return &application, nil
		}
	}

	return nil, nil
}

func (wrapper *CloudFlareWrapper) UpsertApplication(ingress v1.Ingress) (cloudflare.AccessApplication, bool) {
	log.Debugf("Upserting application %s", ingress.Name)

	if wrapper.ApplicationExists(ingress) {
		return wrapper.UpdateApplication(ingress)
	}

	return wrapper.CreateApplication(ingress)
}
