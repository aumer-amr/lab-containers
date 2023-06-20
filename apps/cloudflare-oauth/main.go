package main

import (
	"context"
	"fmt"
	"os"

	log "github.com/sirupsen/logrus"
	v1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	_ "k8s.io/client-go/plugin/pkg/client/auth"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/aumer-amr/lab-containers/cloudflare-oauth/cloudflare"
	cloudflareoauth "github.com/aumer-amr/lab-containers/cloudflare-oauth/type"
)

const ANNOTATION_TAG = "cloudflare-oauth.kubernetes.io/created"

func main() {
	log.Info("Starting Cloudflare OAuth")

	cfg := cloudflareoauth.NewConfig()
	if err := cfg.ParseFlags(os.Args[1:]); err != nil {
		log.Fatalf("Flag parsing error: %v", err)
	}

	if cfg.Debug {
		log.SetLevel(log.DebugLevel)
		log.Debugf("Config: %v", cfg)
	}

	config := &rest.Config{}
	var err error

	if cfg.KubeConfig == "" {
		config, err = rest.InClusterConfig()
		if err != nil {
			panic(err)
		}
	} else {
		config, err = clientcmd.BuildConfigFromFlags("", cfg.KubeConfig)
		if err != nil {
			panic(err)
		}
	}

	// create the clientset
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		panic(err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	cloudflareWrapper, err := cloudflare.Init(*cfg)
	if err != nil || cloudflareWrapper == nil {
		log.Fatal(err)
	}

	for _, namespace := range cfg.Namespaces {
		log.Debugf("Processing namespace: %s", namespace)

		ingressList, err := clientset.NetworkingV1().Ingresses("").Watch(ctx, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("metadata.namespace=%s", namespace),
		})
		if err != nil {
			cancel()
			panic(err)
		}

		for {
			select {
			case event := <-ingressList.ResultChan():
				ingress := event.Object.(*v1.Ingress)

				if FilterIngress(ingress, cfg.AnnotationFilter) {
					log.Debugf("Ingress filtered: %s", ingress.Name)
					continue
				}

				switch event.Type {
				case "ADDED":
					if _, ok := ingress.Annotations[ANNOTATION_TAG]; ok {
						log.Debugf("Ingress already processed: %s", ingress.Name)
						continue
					}

					accessApplication, success := cloudflareWrapper.UpsertApplication(*ingress)
					if success {
						log.Infof("Application created: %s (%s)", accessApplication.Name, accessApplication.ID)

						ingress.Annotations[ANNOTATION_TAG] = "true"
						_, err = clientset.NetworkingV1().Ingresses(namespace).Update(ctx, ingress, metav1.UpdateOptions{
							FieldManager: "cloudflare-oauth",
						})

						if err != nil {
							log.Errorf("Update error for ingress %s: %s", ingress.Name, err)
						} else {
							log.Infof("Update success for ingress %s", ingress.Name)
						}
					} else {
						log.Errorf("Failed to create application: %s", ingress.Name)
					}
				case "DELETED":
					success := cloudflareWrapper.DeleteApplication(*ingress)

					if success {
						log.Infof("Application deleted: %s", ingress.Name)
					} else {
						log.Errorf("Failed to delete application: %s", ingress.Name)
					}
				}
			case <-ctx.Done():
				log.Infof("Context done")
				return
			}
		}
	}
}

func FilterIngress(ingress *v1.Ingress, annotationFilter string) bool {
	for key := range ingress.Annotations {
		if key == annotationFilter {
			return false
		}
	}
	return true
}
