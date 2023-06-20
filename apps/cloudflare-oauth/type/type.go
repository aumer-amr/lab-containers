package cloudflareoauth

import (
	"github.com/alecthomas/kingpin"
	cloudflare "github.com/cloudflare/cloudflare-go"
	log "github.com/sirupsen/logrus"
)

type PolicyType int

const (
	Include PolicyType = iota
	Exclude
)

type Config struct {
	KubeConfig       string
	AnnotationFilter string
	Namespaces       []string
	Debug            bool
	CL_Email         string
	CL_Key           string
	CL_AccountID     string
	Policies         []cloudflare.AccessPolicy
}

var defaultConfig = &Config{
	KubeConfig:       "",
	AnnotationFilter: "external-dns.alpha.kubernetes.io/target",
	Namespaces:       []string{},
	Debug:            false,
	CL_Email:         "",
	CL_Key:           "",
	CL_AccountID:     "",
	Policies:         []cloudflare.AccessPolicy{},
}

func NewConfig() *Config {
	return &Config{}
}

func (cfg *Config) ParseFlags(args []string) error {
	log.Info("Parsing flags")

	app := kingpin.New("cloudflare-oauth", "CloudflareOAth is a Kubernetes controller that manages Cloudflare OAuth policies for Kubernetes ingress.")
	app.DefaultEnvars()

	app.Flag("kubeconfig", "Retrieve target cluster configuration from a Kubernetes configuration file (default: ~/.kube/config)").Default(defaultConfig.KubeConfig).StringVar(&cfg.KubeConfig)
	app.Flag("namespaces", "Limit sources of endpoints to a specific namespace (default: default namespace)").Default("default").StringsVar(&cfg.Namespaces)
	app.Flag("annotation-filter", "Filter sources managed by cloudflare-oauth via annotation using label selector semantics (default: kubernetes.alpha.kubernetes.io/external-target)").Default(defaultConfig.AnnotationFilter).StringVar(&cfg.AnnotationFilter)
	app.Flag("cl_email", "Cloudflare email").Default(defaultConfig.CL_Email).StringVar(&cfg.CL_Email)
	app.Flag("cl_key", "Cloudflare key").Default(defaultConfig.CL_Key).StringVar(&cfg.CL_Key)
	app.Flag("cl_accountid", "Cloudflare accountid").Default(defaultConfig.CL_AccountID).StringVar(&cfg.CL_AccountID)

	_, err := app.Parse(args)
	if err != nil {
		return err
	}

	return nil
}
